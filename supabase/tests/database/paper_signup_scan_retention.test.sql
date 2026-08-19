-- Paper scan retention: purging expired batches enqueues each photo exactly
-- once in the deletion outbox, destroys staging evidence, and preserves the
-- committed signups and roster entries the scan produced.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('b6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'paper-retention@local.test', now(), '{}',
   '{"username":"paper_retention"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('b6100000-0000-4000-8000-000000000001',
   'b6000000-0000-4000-8000-000000000001',
   'Paper retention fixture', 'Local', 'Retention fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '10 day', 'YYYY-MM-DD'),
     'startTime', '10:00',
     'endTime', '12:00',
     'volunteers', 5
   )),
   true, 'completed');

-- Committed batch, 8 days old: past the 7-day post-commit retention.
INSERT INTO public.project_paper_scan_batches (
  id, project_id, schedule_id, created_by, status, committed_at, created_at
)
VALUES
  ('b6400000-0000-4000-8000-000000000001',
   'b6100000-0000-4000-8000-000000000001', 'oneTime',
   'b6000000-0000-4000-8000-000000000001', 'committed',
   now() - interval '8 days', now() - interval '9 days'),
-- Stale draft, 31 days old: past the 30-day draft retention.
  ('b6400000-0000-4000-8000-000000000002',
   'b6100000-0000-4000-8000-000000000001', 'oneTime',
   'b6000000-0000-4000-8000-000000000001', 'draft',
   NULL, now() - interval '31 days'),
-- Fresh draft: must be untouched.
  ('b6400000-0000-4000-8000-000000000003',
   'b6100000-0000-4000-8000-000000000001', 'oneTime',
   'b6000000-0000-4000-8000-000000000001', 'draft',
   NULL, now());

INSERT INTO public.project_paper_scan_images (
  id, batch_id, project_id, object_path, sequence, byte_size, content_type
)
VALUES
  ('b6410000-0000-4000-8000-000000000001',
   'b6400000-0000-4000-8000-000000000001',
   'b6100000-0000-4000-8000-000000000001',
   'paper_signups/b6100000-0000-4000-8000-000000000001/committed/0_a.jpg',
   0, 1024, 'image/jpeg'),
  ('b6410000-0000-4000-8000-000000000002',
   'b6400000-0000-4000-8000-000000000002',
   'b6100000-0000-4000-8000-000000000001',
   'paper_signups/b6100000-0000-4000-8000-000000000001/stale/0_b.jpg',
   0, 1024, 'image/jpeg'),
  ('b6410000-0000-4000-8000-000000000003',
   'b6400000-0000-4000-8000-000000000003',
   'b6100000-0000-4000-8000-000000000001',
   'paper_signups/b6100000-0000-4000-8000-000000000001/fresh/0_c.jpg',
   0, 1024, 'image/jpeg');

-- The committed batch produced a signup and a roster entry; both must
-- survive the purge of the staging evidence.
INSERT INTO public.anonymous_signups (id, project_id, email, name, confirmed_at)
VALUES ('b6420000-0000-4000-8000-000000000001',
        'b6100000-0000-4000-8000-000000000001',
        'paper-retained@local.test', 'Retained Rae', now());

INSERT INTO public.project_signups (
  id, project_id, anonymous_id, schedule_id, status, source
)
VALUES ('b6430000-0000-4000-8000-000000000001',
        'b6100000-0000-4000-8000-000000000001',
        'b6420000-0000-4000-8000-000000000001', 'oneTime', 'attended', 'paper_scan');

INSERT INTO public.project_paper_scan_rows (
  id, batch_id, project_id, sheet_row_number, raw_extraction,
  name, email, decision, outcome, committed_signup_id, committed_anonymous_id
)
VALUES ('b6440000-0000-4000-8000-000000000001',
        'b6400000-0000-4000-8000-000000000001',
        'b6100000-0000-4000-8000-000000000001', 1, '{}',
        'Retained Rae', 'paper-retained@local.test', 'include',
        'signup_created',
        'b6430000-0000-4000-8000-000000000001',
        'b6420000-0000-4000-8000-000000000001');

INSERT INTO public.project_paper_roster_entries (
  id, project_id, batch_id, schedule_id, name, recorded_by
)
VALUES ('b6450000-0000-4000-8000-000000000001',
        'b6100000-0000-4000-8000-000000000001',
        'b6400000-0000-4000-8000-000000000001', 'oneTime', 'Roster Riley',
        'b6000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- First purge: expired committed batch + stale draft
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  public.purge_expired_paper_scan_batches(50),
  2,
  'the purge removes the expired committed batch and the stale draft'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.paper_scan_storage_deletion_queue AS queue
   WHERE queue.object_path IN (
     'paper_signups/b6100000-0000-4000-8000-000000000001/committed/0_a.jpg',
     'paper_signups/b6100000-0000-4000-8000-000000000001/stale/0_b.jpg'
   )),
  2::bigint,
  'each purged photo is enqueued for storage deletion'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.paper_scan_storage_deletion_queue AS queue
   WHERE queue.object_path =
     'paper_signups/b6100000-0000-4000-8000-000000000001/fresh/0_c.jpg'),
  0::bigint,
  'photos from fresh batches are not enqueued'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_rows AS scan_rows
   WHERE scan_rows.batch_id = 'b6400000-0000-4000-8000-000000000001'),
  0::bigint,
  'staging rows are destroyed with their batch'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_signups AS signups
   WHERE signups.id = 'b6430000-0000-4000-8000-000000000001'),
  1::bigint,
  'committed signups survive the purge'
);
SELECT extensions.ok(
  (SELECT roster.batch_id IS NULL
   FROM public.project_paper_roster_entries AS roster
   WHERE roster.id = 'b6450000-0000-4000-8000-000000000001'),
  'roster entries survive with their batch link cleared'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches AS batches
   WHERE batches.id = 'b6400000-0000-4000-8000-000000000003'),
  1::bigint,
  'fresh drafts are untouched'
);

-- ---------------------------------------------------------------------------
-- Second purge: idempotent, no duplicate outbox rows
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  public.purge_expired_paper_scan_batches(50),
  0,
  'a repeated purge finds nothing new'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.paper_scan_storage_deletion_queue AS queue
   WHERE queue.object_path LIKE 'paper_signups/b6100000-%'),
  2::bigint,
  'the outbox never accumulates duplicate paths'
);

SELECT * FROM extensions.finish();

ROLLBACK;
