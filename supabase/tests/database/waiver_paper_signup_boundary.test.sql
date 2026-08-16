-- Paper signup commits obey the waiver invariant.
--
-- A scanned attendance sheet is not evidence of digital waiver consent, and
-- fabricating a waiver_signatures row for one would be a lie. commit_paper_-
-- signup_batch therefore fails closed: it refuses an unpublished project
-- outright, and on a waiver-required project it refuses exactly the rows that
-- would mint a new signup with no evidence. Marking an existing (already
-- signed) signup attended and recording a roster-only headcount stay
-- available, because neither creates an unevidenced signup.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures: one published waiver project, one staged waiver project
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('c9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'paper-waiver-organizer@local.test', now(), '{}',
   '{"username":"paper_waiver_organizer"}', now(), now()),
  ('c9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'paper-waiver-signed@local.test', now(), '{}',
   '{"username":"paper_waiver_signed"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, workflow_status,
  waiver_required, waiver_allow_upload, waiver_disable_esignature,
  waiver_pdf_storage_path
)
VALUES
  ('c9100000-0000-4000-8000-000000000001',
   'c9000000-0000-4000-8000-000000000001',
   'Paper waiver project', 'Local', 'Paper waiver fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00',
     'endTime', '12:00',
     'volunteers', 5
   )),
   true, 'upcoming', 'published', true, true, true,
   'project_waivers/c9100000-0000-4000-8000-000000000001/source.pdf'),
  ('c9100000-0000-4000-8000-000000000002',
   'c9000000-0000-4000-8000-000000000001',
   'Staged paper project', 'Local', 'Paper waiver fixture', 'oneTime', 'manual',
   jsonb_build_object('oneTime', jsonb_build_object(
     'date', to_char((clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '2 day', 'YYYY-MM-DD'),
     'startTime', '10:00',
     'endTime', '12:00',
     'volunteers', 5
   )),
   true, 'upcoming', 'draft', false, true, false, NULL);

-- Someone who really did sign digitally before the event.
INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES ('c9200000-0000-4000-8000-000000000001',
        'c9100000-0000-4000-8000-000000000001',
        'c9000000-0000-4000-8000-000000000002', 'oneTime', 'approved');

-- The event is over by the time paper scans are reconciled.
UPDATE public.projects
SET status = 'completed'
WHERE id IN (
  'c9100000-0000-4000-8000-000000000001',
  'c9100000-0000-4000-8000-000000000002'
);

INSERT INTO public.waiver_signatures (
  project_id, signup_id, user_id, signer_name, signer_email, signature_type
)
VALUES ('c9100000-0000-4000-8000-000000000001',
        'c9200000-0000-4000-8000-000000000001',
        'c9000000-0000-4000-8000-000000000002',
        'Signed Volunteer', 'paper-waiver-signed@local.test', 'typed');

INSERT INTO public.project_paper_scan_batches (
  id, project_id, schedule_id, created_by, status
)
VALUES
  ('c9300000-0000-4000-8000-000000000001',
   'c9100000-0000-4000-8000-000000000001', 'oneTime',
   'c9000000-0000-4000-8000-000000000001', 'review'),
  ('c9300000-0000-4000-8000-000000000002',
   'c9100000-0000-4000-8000-000000000002', 'oneTime',
   'c9000000-0000-4000-8000-000000000001', 'review');

INSERT INTO public.project_paper_scan_rows (
  id, batch_id, project_id, sheet_row_number, raw_extraction,
  name, email, check_in_time, check_out_time, decision
)
VALUES
  -- Already signed digitally: only marked attended, no new signup minted.
  ('c9400000-0000-4000-8000-000000000001',
   'c9300000-0000-4000-8000-000000000001',
   'c9100000-0000-4000-8000-000000000001', 1, '{}',
   'Signed Volunteer', 'paper-waiver-signed@local.test', NULL, NULL, 'include'),
  -- Never signed anything: would need a brand new signup.
  ('c9400000-0000-4000-8000-000000000002',
   'c9300000-0000-4000-8000-000000000001',
   'c9100000-0000-4000-8000-000000000001', 2, '{}',
   'Unsigned Stranger', 'paper-waiver-stranger@local.test', NULL, NULL,
   'include'),
  -- Headcount only: no signup, no certificate, no waiver to fabricate.
  ('c9400000-0000-4000-8000-000000000003',
   'c9300000-0000-4000-8000-000000000001',
   'c9100000-0000-4000-8000-000000000001', 3, '{}',
   'No Email Nell', NULL, NULL, NULL, 'include'),
  -- Belongs to the staged project batch.
  ('c9400000-0000-4000-8000-000000000004',
   'c9300000-0000-4000-8000-000000000002',
   'c9100000-0000-4000-8000-000000000002', 1, '{}',
   'Staged Sam', 'paper-waiver-staged@local.test', NULL, NULL, 'include');

-- ---------------------------------------------------------------------------
-- An unpublished project refuses the whole batch
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    SELECT * FROM public.commit_paper_signup_batch(
      'c9300000-0000-4000-8000-000000000002',
      'c9000000-0000-4000-8000-000000000001',
      ARRAY['c9400000-0000-4000-8000-000000000004']::uuid[],
      false,
      'c9500000-0000-4000-8000-000000000009'
    )
  $$,
  'commit_paper_signup_batch: project is not published',
  'a staged project cannot gain attendance through a paper commit'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c9100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the staged project has no signups'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.project_paper_scan_batches
    WHERE id = 'c9300000-0000-4000-8000-000000000002'
  ),
  'review',
  'the refused batch was not marked committing'
);

-- ---------------------------------------------------------------------------
-- On a waiver project only the unevidenced row fails
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE waiver_commit_result AS
SELECT * FROM public.commit_paper_signup_batch(
  'c9300000-0000-4000-8000-000000000001',
  'c9000000-0000-4000-8000-000000000001',
  ARRAY[
    'c9400000-0000-4000-8000-000000000001',
    'c9400000-0000-4000-8000-000000000002',
    'c9400000-0000-4000-8000-000000000003'
  ]::uuid[],
  false,
  'c9500000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (
    SELECT outcome FROM waiver_commit_result
    WHERE row_id = 'c9400000-0000-4000-8000-000000000001'
  ),
  'signup_updated',
  'a volunteer who really signed is still marked attended'
);

SELECT extensions.is(
  (
    SELECT outcome FROM waiver_commit_result
    WHERE row_id = 'c9400000-0000-4000-8000-000000000002'
  ),
  'failed',
  'a paper row that would mint an unevidenced signup fails'
);

SELECT extensions.is(
  (
    SELECT detail FROM waiver_commit_result
    WHERE row_id = 'c9400000-0000-4000-8000-000000000002'
  ),
  'waiver_required',
  'the refusal names the waiver invariant, not a capacity problem'
);

SELECT extensions.is(
  (
    SELECT outcome FROM waiver_commit_result
    WHERE row_id = 'c9400000-0000-4000-8000-000000000003'
  ),
  'roster_only',
  'a headcount-only row is still recorded'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.project_signups
    WHERE id = 'c9200000-0000-4000-8000-000000000001'
  ),
  'attended',
  'the digitally signed signup really was marked attended'
);

-- The invariant itself: every signup on this waiver project has evidence.
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups AS signups
    WHERE signups.project_id = 'c9100000-0000-4000-8000-000000000001'
      AND NOT EXISTS (
        SELECT 1
        FROM public.waiver_signatures AS signatures
        WHERE signatures.signup_id = signups.id
      )
  ),
  0::bigint,
  'no signup on the waiver project lacks waiver evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c9100000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the refused paper row created no signup at all'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.anonymous_signups
    WHERE project_id = 'c9100000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the refused paper row created no guest identity either'
);

SELECT extensions.is(
  (
    SELECT outcome_detail
    FROM public.project_paper_scan_rows
    WHERE id = 'c9400000-0000-4000-8000-000000000002'
  ),
  'waiver_required',
  'the reviewer sees the truthful per-row reason on the staging row'
);

-- ---------------------------------------------------------------------------
-- Replay is still idempotent for the rows that did commit
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.commit_paper_signup_batch(
      'c9300000-0000-4000-8000-000000000001',
      'c9000000-0000-4000-8000-000000000001',
      ARRAY[
        'c9400000-0000-4000-8000-000000000001',
        'c9400000-0000-4000-8000-000000000002',
        'c9400000-0000-4000-8000-000000000003'
      ]::uuid[],
      false,
      'c9500000-0000-4000-8000-000000000001'
    )
  ),
  3::bigint,
  'the same idempotency key replays the stored per-row outcomes'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'c9100000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the replay created no additional signup'
);

SELECT * FROM extensions.finish();

ROLLBACK;
