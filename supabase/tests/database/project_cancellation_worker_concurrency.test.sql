-- Two-session cancellation/approval serialization and reaper concurrency.
-- Authored for the isolated pgTAP gate; intentionally not executed here.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(14);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('cb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'race-owner@local.test', now(), '{}', '{"username":"race_owner"}', now(), now()),
  ('cb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'race-vol-one@local.test', now(), '{}', '{"username":"race_vol_one"}', now(), now()),
  ('cb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'race-vol-two@local.test', now(), '{}', '{"username":"race_vol_two"}', now(), now());

UPDATE public.profiles
SET email = CASE id
  WHEN 'cb000000-0000-4000-8000-000000000001'::uuid THEN 'race-owner@local.test'
  WHEN 'cb000000-0000-4000-8000-000000000002'::uuid THEN 'race-vol-one@local.test'
  ELSE 'race-vol-two@local.test'
END
WHERE id::text LIKE 'cb000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('cb100000-0000-4000-8000-000000000001',
        'Cancellation Race Org', 'cancel-race-org', 'nonprofit', 'CXR001');

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000001',
   'cb100000-0000-4000-8000-000000000001',
   'Cancellation wins race', 'Local', 'Race fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-20","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming'),
  ('cb200000-0000-4000-8000-000000000002',
   'cb000000-0000-4000-8000-000000000001',
   'cb100000-0000-4000-8000-000000000001',
   'Reaper race', 'Local', 'Reaper fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-21","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming'),
  ('cb200000-0000-4000-8000-000000000003',
   'cb000000-0000-4000-8000-000000000001',
   'cb100000-0000-4000-8000-000000000001',
   'Approval wins race', 'Local', 'Race fixture', 'oneTime', 'manual',
   '{"oneTime":{"date":"2030-08-22","startTime":"10:00","endTime":"12:00","volunteers":20}}',
   true, 'upcoming');

INSERT INTO public.project_signups
  (id, project_id, user_id, schedule_id, status, created_at)
VALUES
  ('cb400000-0000-4000-8000-000000000001',
   'cb200000-0000-4000-8000-000000000001',
   'cb000000-0000-4000-8000-000000000002', 'oneTime', 'pending', now()),
  ('cb400000-0000-4000-8000-000000000002',
   'cb200000-0000-4000-8000-000000000002',
   'cb000000-0000-4000-8000-000000000002', 'oneTime', 'approved', now()),
  ('cb400000-0000-4000-8000-000000000003',
   'cb200000-0000-4000-8000-000000000002',
   'cb000000-0000-4000-8000-000000000003', 'oneTime', 'approved', now()),
  ('cb400000-0000-4000-8000-000000000004',
   'cb200000-0000-4000-8000-000000000003',
   'cb000000-0000-4000-8000-000000000003', 'oneTime', 'pending', now());

SELECT extensions.dblink_connect(
  'cancellation_race_probe',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

-- Cancellation owns the project lock. A concurrent pending -> approved write
-- must wait, then observe cancelled and fail instead of escaping the snapshot.
BEGIN;

SELECT 1
FROM public.projects
WHERE id = 'cb200000-0000-4000-8000-000000000001'
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'cancellation_race_probe',
  $$UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'cb400000-0000-4000-8000-000000000001'
    RETURNING id$$
);

SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('cancellation_race_probe'),
  1,
  'approval waits on the same project row held by cancellation'
);

SET LOCAL request.jwt.claims =
  '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT extensions.is(
  public.cancel_project_transactional(
    'cb200000-0000-4000-8000-000000000001', 'Race cancelled'
  )->>'outcome',
  'cancelled',
  'cancellation commits the transition and snapshot while holding the lock'
);

RESET ROLE;
COMMIT;

SELECT pg_sleep(0.25);

SELECT *
FROM extensions.dblink_get_result(
  'cancellation_race_probe', false
) AS result(id uuid);

SELECT extensions.ok(
  position(
    'signups can only be approved for active projects'
    IN extensions.dblink_error_message('cancellation_race_probe')
  ) > 0,
  'the losing approval is denied after cancellation commits'
);

SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'cb400000-0000-4000-8000-000000000001'),
  'pending',
  'the denied approval leaves the signup pending'
);

SELECT extensions.is(
  (SELECT recipient_count FROM public.project_cancellation_jobs
   WHERE project_id = 'cb200000-0000-4000-8000-000000000001'),
  0,
  'the cancellation snapshot excludes the concurrently denied approval'
);

-- In the converse interleaving, approval already owns the project lock. The
-- waiting cancellation must refresh after that commit and include the winner.
BEGIN;

UPDATE public.project_signups
SET status = 'approved'
WHERE id = 'cb400000-0000-4000-8000-000000000004';

SELECT extensions.dblink_send_query(
  'cancellation_race_probe',
  $$WITH configured AS MATERIALIZED (
      SELECT set_config(
        'request.jwt.claims',
        '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}',
        false
      )
    )
    SELECT public.cancel_project_transactional(
      'cb200000-0000-4000-8000-000000000003', 'Approval won first'
    )::text
    FROM configured$$
);

SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('cancellation_race_probe'),
  1,
  'cancellation waits when approval already owns the project lock'
);

COMMIT;

CREATE TEMP TABLE approval_first_cancellation AS
SELECT payload::jsonb
FROM extensions.dblink_get_result('cancellation_race_probe') AS result(payload text);

SELECT extensions.is(
  (SELECT payload->>'outcome' FROM approval_first_cancellation),
  'cancelled',
  'the waiting cancellation succeeds after the approval commits'
);

SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'cb400000-0000-4000-8000-000000000004'),
  'approved',
  'the approval-first transaction remains approved'
);

SELECT extensions.is(
  (SELECT recipient_count FROM public.project_cancellation_jobs
   WHERE project_id = 'cb200000-0000-4000-8000-000000000003'),
  1,
  'the waiting cancellation freezes the committed approval in its audience'
);

-- Create two expired recipient leases for a second cancellation.
BEGIN;
SET LOCAL request.jwt.claims =
  '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.cancel_project_transactional(
  'cb200000-0000-4000-8000-000000000002', 'Reaper fixture'
);
RESET ROLE;
COMMIT;

CREATE TEMP TABLE cancellation_race_jobs AS
SELECT *
FROM public.claim_project_cancellation_jobs('race-worker', 10, 120);

CREATE TEMP TABLE cancellation_race_deliveries AS
SELECT *
FROM public.claim_project_cancellation_deliveries(
  (SELECT id FROM cancellation_race_jobs
   WHERE project_id = 'cb200000-0000-4000-8000-000000000002'),
  'race-worker', 10, 120
);

UPDATE public.project_cancellation_deliveries
SET lease_expires_at = now() - interval '1 minute'
WHERE id IN (SELECT id FROM cancellation_race_deliveries);

UPDATE public.project_cancellation_deliveries
SET email_state = 'sending'
WHERE id = (
  SELECT id FROM cancellation_race_deliveries ORDER BY id LIMIT 1
);

BEGIN;

CREATE TEMP TABLE cancellation_first_reap ON COMMIT DROP AS
SELECT public.reap_project_cancellation_delivery_leases(1) AS payload;

SELECT extensions.dblink_send_query(
  'cancellation_race_probe',
  'SELECT public.reap_project_cancellation_delivery_leases(10)::text'
);

SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('cancellation_race_probe'),
  0,
  'a concurrent delivery reaper skips the row locked by the first reaper'
);

CREATE TEMP TABLE cancellation_second_reap ON COMMIT DROP AS
SELECT payload::jsonb
FROM extensions.dblink_get_result('cancellation_race_probe') AS result(payload text);

SELECT extensions.is(
  (SELECT (payload->>'released')::integer FROM cancellation_first_reap),
  1,
  'the bounded first reaper handles exactly its one-row limit'
);

SELECT extensions.is(
  (SELECT (payload->>'released')::integer FROM cancellation_second_reap),
  1,
  'the concurrent reaper handles the other expired row exactly once'
);

COMMIT;

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries
   WHERE id IN (SELECT id FROM cancellation_race_deliveries)
     AND work_state = 'idle'),
  2::bigint,
  'both expired leases are reaped without overlap or a stranded row'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.project_cancellation_deliveries
   WHERE id IN (SELECT id FROM cancellation_race_deliveries)
     AND email_state = 'unknown_outcome'),
  1::bigint,
  'only the lease that crossed sending becomes terminally ambiguous'
);

SELECT extensions.dblink_disconnect('cancellation_race_probe');

DELETE FROM public.project_cancellation_deliveries
WHERE project_id IN (
  'cb200000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000003'
);
DELETE FROM public.project_cancellation_jobs
WHERE project_id IN (
  'cb200000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000003'
);
DELETE FROM public.project_signups
WHERE project_id IN (
  'cb200000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000003'
);
DELETE FROM public.projects
WHERE id IN (
  'cb200000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000003'
);
DELETE FROM public.organizations
WHERE id = 'cb100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'cb000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000002',
  'cb000000-0000-4000-8000-000000000003'
);

SELECT * FROM extensions.finish();
