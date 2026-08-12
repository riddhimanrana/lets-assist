-- Paper signup scan commit: privileges, retroactive commit on a completed
-- project, provenance, time clamping, dedupe, capacity, idempotent replay,
-- actor authorization, and organizer-scoped RLS.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(41);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the paper commit'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute the paper commit'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.commit_paper_signup_batch(uuid,uuid,uuid[],boolean,uuid)',
    'EXECUTE'
  ),
  'the server role can execute the paper commit'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.purge_expired_paper_scan_batches(integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot purge scan batches'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.purge_expired_paper_scan_batches(integer)',
    'EXECUTE'
  ),
  'the server role can purge scan batches'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_paper_scan_batches', 'SELECT'),
  'anonymous clients cannot read scan batches'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.project_paper_scan_batches', 'INSERT'),
  'authenticated clients cannot insert scan batches directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.project_paper_scan_rows', 'UPDATE'),
  'authenticated clients cannot edit scan rows directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.paper_scan_storage_deletion_queue', 'SELECT'),
  'anonymous clients cannot read the scan deletion outbox'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.paper_scan_storage_deletion_queue', 'SELECT'),
  'authenticated clients cannot read the scan deletion outbox'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('b5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'paper-organizer@local.test', now(), '{}',
   '{"username":"paper_organizer"}', now(), now()),
  ('b5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'paper-volunteer@local.test', now(), '{}',
   '{"username":"paper_volunteer"}', now(), now()),
  ('b5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'paper-staff@local.test', now(), '{}',
   '{"username":"paper_staff"}', now(), now()),
  ('b5000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'paper-outsider@local.test', now(), '{}',
   '{"username":"paper_outsider"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('b5300000-0000-4000-8000-000000000001', 'Paper Scan Org',
        'paper_scan_org', 'nonprofit', '731046');

INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES ('b5300000-0000-4000-8000-000000000001',
        'b5000000-0000-4000-8000-000000000003', 'staff');

-- A finished one-time event two days ago, capacity 2, already 'completed':
-- the exact state insert_project_signup_with_capacity refuses to touch.
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('b5100000-0000-4000-8000-000000000001',
   'b5000000-0000-4000-8000-000000000001',
   'Paper commit fixture', 'Local', 'Paper scan fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00',
     'endTime', '12:00',
     'volunteers', 2
   )),
   true, 'upcoming');

-- Org-owned project that opted out of staff management.
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status,
  organization_id, can_be_managed_by_staff
)
VALUES
  ('b5100000-0000-4000-8000-000000000002',
   'b5000000-0000-4000-8000-000000000001',
   'Paper staff-denied fixture', 'Local', 'Paper scan fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00',
     'endTime', '12:00',
     'volunteers', 5
   )),
   true, 'upcoming',
   'b5300000-0000-4000-8000-000000000001', false);

-- Existing digital signup for the account-holding volunteer.
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('b5200000-0000-4000-8000-000000000001',
        'b5100000-0000-4000-8000-000000000001',
        'b5000000-0000-4000-8000-000000000002', 'oneTime', 'approved');

UPDATE public.projects
SET status = 'completed'
WHERE id IN (
  'b5100000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000002'
);

INSERT INTO public.project_paper_scan_batches (id, project_id, schedule_id, created_by, status)
VALUES
  ('b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 'oneTime',
   'b5000000-0000-4000-8000-000000000001', 'review'),
  ('b5400000-0000-4000-8000-000000000002',
   'b5100000-0000-4000-8000-000000000002', 'oneTime',
   'b5000000-0000-4000-8000-000000000001', 'review'),
  ('b5400000-0000-4000-8000-000000000003',
   'b5100000-0000-4000-8000-000000000001', 'oneTime',
   'b5000000-0000-4000-8000-000000000001', 'review');

INSERT INTO public.project_paper_scan_rows (
  id, batch_id, project_id, sheet_row_number, raw_extraction,
  name, email, check_in_time, check_out_time, decision
)
VALUES
  -- Matches the existing digital signup through the profile email.
  ('b5500000-0000-4000-8000-000000000001',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 1, '{}',
   'Paper Volunteer', 'paper-volunteer@local.test', NULL, NULL, 'include'),
  -- Stranger with out-of-window times: in 09:00 (early), out 20:00 (late).
  ('b5500000-0000-4000-8000-000000000002',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 2, '{}',
   'Pat Stranger', 'paper-stranger@local.test',
   ((to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD') || ' 09:00')::timestamp AT TIME ZONE 'America/Los_Angeles'),
   ((to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD') || ' 20:00')::timestamp AT TIME ZONE 'America/Los_Angeles'),
   'include'),
  -- No email: roster only.
  ('b5500000-0000-4000-8000-000000000003',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 3, '{}',
   'No Email Nancy', NULL, NULL, NULL, 'include'),
  -- Duplicate of row 2 within the same batch.
  ('b5500000-0000-4000-8000-000000000004',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 4, '{}',
   'Pat Stranger', 'paper-stranger@local.test', NULL, NULL, 'include'),
  -- Over capacity once row 2 lands (capacity 2).
  ('b5500000-0000-4000-8000-000000000005',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 5, '{}',
   'Over Cap Casey', 'paper-extra@local.test', NULL, NULL, 'include'),
  -- Excluded by the reviewer; must remain untouched.
  ('b5500000-0000-4000-8000-000000000006',
   'b5400000-0000-4000-8000-000000000001',
   'b5100000-0000-4000-8000-000000000001', 6, '{}',
   'Excluded Erin', 'paper-excluded@local.test', NULL, NULL, 'exclude'),
  -- Belongs to the staff-denied project batch; cross-batch containment probe.
  ('b5500000-0000-4000-8000-000000000007',
   'b5400000-0000-4000-8000-000000000002',
   'b5100000-0000-4000-8000-000000000002', 1, '{}',
   'Other Project Olive', 'paper-other@local.test', NULL, NULL, 'include'),
  -- Over-capacity row committed with the explicit organizer override.
  ('b5500000-0000-4000-8000-000000000008',
   'b5400000-0000-4000-8000-000000000003',
   'b5100000-0000-4000-8000-000000000001', 1, '{}',
   'Late Addition Lee', 'paper-late@local.test', NULL, NULL, 'include');

-- ---------------------------------------------------------------------------
-- Commit batch 1 (allow_over_capacity = false) on a completed project
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE commit_result_one AS
SELECT * FROM public.commit_paper_signup_batch(
  'b5400000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  ARRAY[
    'b5500000-0000-4000-8000-000000000001',
    'b5500000-0000-4000-8000-000000000002',
    'b5500000-0000-4000-8000-000000000003',
    'b5500000-0000-4000-8000-000000000004',
    'b5500000-0000-4000-8000-000000000005',
    'b5500000-0000-4000-8000-000000000006'
  ]::uuid[],
  false,
  'b5600000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT result.outcome FROM commit_result_one AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000001'),
  'signup_updated',
  'a row matching an existing digital signup updates it in place'
);
SELECT extensions.is(
  (SELECT signups.status FROM public.project_signups AS signups
   WHERE signups.id = 'b5200000-0000-4000-8000-000000000001'),
  'attended',
  'the matched digital signup is marked attended on a completed project'
);
SELECT extensions.is(
  (SELECT signups.source FROM public.project_signups AS signups
   WHERE signups.id = 'b5200000-0000-4000-8000-000000000001'),
  'digital',
  'paper confirmation of a digital signup keeps digital provenance'
);
SELECT extensions.is(
  (SELECT result.outcome FROM commit_result_one AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000002'),
  'signup_created',
  'a stranger email creates a new attended signup'
);
SELECT extensions.is(
  (SELECT signups.source FROM public.project_signups AS signups
   WHERE signups.id = (SELECT result.signup_id FROM commit_result_one AS result
                       WHERE result.row_id = 'b5500000-0000-4000-8000-000000000002')),
  'paper_scan',
  'paper-created signups carry paper_scan provenance'
);
SELECT extensions.ok(
  (SELECT signups.check_out_time = slot.ends_at
     AND signups.check_in_time = slot.starts_at
   FROM public.project_signups AS signups
   CROSS JOIN private.resolve_project_schedule_slot(
     signups.project_id, signups.schedule_id) AS slot
   WHERE signups.id = (SELECT result.signup_id FROM commit_result_one AS result
                       WHERE result.row_id = 'b5500000-0000-4000-8000-000000000002')),
  'transcribed times are clamped to the scheduled slot window'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.anonymous_signups AS anon
   WHERE anon.project_id = 'b5100000-0000-4000-8000-000000000001'
     AND lower(anon.email) = 'paper-stranger@local.test'),
  1::bigint,
  'exactly one anonymous identity exists for the stranger email'
);
SELECT extensions.ok(
  (SELECT anon.confirmed_at IS NOT NULL FROM public.anonymous_signups AS anon
   WHERE anon.project_id = 'b5100000-0000-4000-8000-000000000001'
     AND lower(anon.email) = 'paper-stranger@local.test'),
  'organizer review counts as anonymous-signup confirmation'
);
SELECT extensions.is(
  (SELECT result.outcome FROM commit_result_one AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000003'),
  'roster_only',
  'a row without an email becomes roster-only'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_roster_entries AS roster
   WHERE roster.scan_row_id = 'b5500000-0000-4000-8000-000000000003'),
  1::bigint,
  'the roster entry exists for the email-less row'
);
SELECT extensions.is(
  (SELECT result.outcome || ':' || result.detail FROM commit_result_one AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000004'),
  'skipped:duplicate_in_batch',
  'a duplicate email within one batch is skipped, not double-committed'
);
SELECT extensions.is(
  (SELECT result.outcome || ':' || result.detail FROM commit_result_one AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000005'),
  'failed:slot_full',
  'capacity is enforced when the organizer has not opted into exceeding it'
);
SELECT extensions.is(
  (SELECT scan_rows.outcome FROM public.project_paper_scan_rows AS scan_rows
   WHERE scan_rows.id = 'b5500000-0000-4000-8000-000000000006'),
  'pending',
  'reviewer-excluded rows are untouched by the commit'
);
SELECT extensions.is(
  (SELECT batches.status FROM public.project_paper_scan_batches AS batches
   WHERE batches.id = 'b5400000-0000-4000-8000-000000000001'),
  'committed',
  'the batch settles to committed'
);
SELECT extensions.is(
  (SELECT batches.committed_row_count || '/' || batches.roster_row_count
   FROM public.project_paper_scan_batches AS batches
   WHERE batches.id = 'b5400000-0000-4000-8000-000000000001'),
  '2/1',
  'batch counters record two signups and one roster entry'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_signups AS signups
   WHERE signups.project_id = 'b5100000-0000-4000-8000-000000000001'
     AND signups.schedule_id = 'oneTime'
     AND signups.status IN ('approved', 'attended')),
  2::bigint,
  'the slot holds exactly two active signups after the first commit'
);

-- ---------------------------------------------------------------------------
-- Idempotent replay
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE commit_result_replay AS
SELECT * FROM public.commit_paper_signup_batch(
  'b5400000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  ARRAY['b5500000-0000-4000-8000-000000000002']::uuid[],
  false,
  'b5600000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT result.outcome FROM commit_result_replay AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000002'),
  'signup_created',
  'replay with the same idempotency key reports the stored outcome'
);
SELECT extensions.is(
  (SELECT result.signup_id FROM commit_result_replay AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000002'),
  (SELECT scan_rows.committed_signup_id FROM public.project_paper_scan_rows AS scan_rows
   WHERE scan_rows.id = 'b5500000-0000-4000-8000-000000000002'),
  'replay returns the identical signup id'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_signups AS signups
   WHERE signups.project_id = 'b5100000-0000-4000-8000-000000000001'
     AND signups.schedule_id = 'oneTime'
     AND signups.status IN ('approved', 'attended')),
  2::bigint,
  'replay creates no additional signups'
);
SELECT extensions.is(
  (SELECT result.outcome || ':' || result.detail
   FROM public.commit_paper_signup_batch(
     'b5400000-0000-4000-8000-000000000001',
     'b5000000-0000-4000-8000-000000000001',
     ARRAY['b5500000-0000-4000-8000-000000000002']::uuid[],
     false,
     'b5600000-0000-4000-8000-000000000099'
   ) AS result),
  'skipped:already_committed',
  'a different idempotency key on a committed batch changes nothing'
);

-- ---------------------------------------------------------------------------
-- Over-capacity with explicit organizer override + cross-batch containment
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE commit_result_three AS
SELECT * FROM public.commit_paper_signup_batch(
  'b5400000-0000-4000-8000-000000000003',
  'b5000000-0000-4000-8000-000000000001',
  ARRAY[
    'b5500000-0000-4000-8000-000000000008',
    'b5500000-0000-4000-8000-000000000007'
  ]::uuid[],
  true,
  'b5600000-0000-4000-8000-000000000003'
);

SELECT extensions.is(
  (SELECT result.outcome FROM commit_result_three AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000008'),
  'signup_created',
  'the organizer override records an over-capacity attendee'
);
SELECT extensions.ok(
  (SELECT result.over_capacity FROM commit_result_three AS result
   WHERE result.row_id = 'b5500000-0000-4000-8000-000000000008'),
  'the over-capacity flag is reported per row'
);
SELECT extensions.is(
  (SELECT scan_rows.outcome FROM public.project_paper_scan_rows AS scan_rows
   WHERE scan_rows.id = 'b5500000-0000-4000-8000-000000000007'),
  'pending',
  'a row from another batch is never committed by this batch'
);

-- ---------------------------------------------------------------------------
-- Actor authorization
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT * FROM public.commit_paper_signup_batch(
      'b5400000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000004',
      ARRAY['b5500000-0000-4000-8000-000000000007']::uuid[],
      false,
      'b5600000-0000-4000-8000-000000000004'
    )
  $$,
  'P0001',
  'commit_paper_signup_batch: actor is not a project organizer',
  'an unrelated user cannot commit a batch'
);
SELECT extensions.throws_ok(
  $$
    SELECT * FROM public.commit_paper_signup_batch(
      'b5400000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000003',
      ARRAY['b5500000-0000-4000-8000-000000000007']::uuid[],
      false,
      'b5600000-0000-4000-8000-000000000005'
    )
  $$,
  'P0001',
  'commit_paper_signup_batch: actor is not a project organizer',
  'org staff cannot commit when the project opted out of staff management'
);

-- ---------------------------------------------------------------------------
-- RLS: organizer-scoped reads
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"b5000000-0000-4000-8000-000000000003","role":"authenticated"}';

SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches AS batches
   WHERE batches.project_id = 'b5100000-0000-4000-8000-000000000002'),
  0::bigint,
  'staff cannot see scan batches for a project that opted out of staff management'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_rows AS scan_rows
   WHERE scan_rows.project_id = 'b5100000-0000-4000-8000-000000000002'),
  0::bigint,
  'staff cannot see scan rows for a project that opted out of staff management'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"b5000000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT extensions.is(
  (SELECT count(*) FROM public.project_paper_scan_batches AS batches),
  0::bigint,
  'unrelated users see no scan batches at all'
);

SET LOCAL "request.jwt.claims" =
  '{"sub":"b5000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.ok(
  (SELECT count(*) >= 2 FROM public.project_paper_scan_batches AS batches
   WHERE batches.project_id = 'b5100000-0000-4000-8000-000000000001'),
  'the project creator can read their own scan batches'
);
SELECT extensions.ok(
  (SELECT count(*) >= 1 FROM public.project_paper_roster_entries AS roster
   WHERE roster.project_id = 'b5100000-0000-4000-8000-000000000001'),
  'the project creator can read their roster entries'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_paper_scan_rows
    SET name = 'Forged'
    WHERE id = 'b5500000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'permission denied for table project_paper_scan_rows',
  'even the organizer cannot edit staging rows outside the server action'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
