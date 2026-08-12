-- Cross-branch proof for atomic unreject versus transactional cancellation.
-- Authored for the isolated pgTAP gate; intentionally not executed here.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(11);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ef000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'integration-owner@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'integration-vol-one@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'integration-vol-two@local.test', now(), '{}', '{}', now(), now()),
  ('ef000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'integration-inactive-admin@local.test', now(), '{}', '{}', now(), now());

UPDATE public.profiles
SET email = CASE id
  WHEN 'ef000000-0000-4000-8000-000000000001'::uuid THEN 'integration-owner@local.test'
  WHEN 'ef000000-0000-4000-8000-000000000002'::uuid THEN 'integration-vol-one@local.test'
  WHEN 'ef000000-0000-4000-8000-000000000003'::uuid THEN 'integration-vol-two@local.test'
  ELSE 'integration-inactive-admin@local.test'
END
WHERE id::text LIKE 'ef000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'Project Lifecycle Integration Org',
  'project-lifecycle-integration-org',
  'nonprofit',
  'PLI001'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000004',
  'admin',
  'inactive'
);

INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES
  ('ef200000-0000-4000-8000-000000000001',
   'ef000000-0000-4000-8000-000000000001',
   'ef100000-0000-4000-8000-000000000001',
   'Cancellation wins unreject race', 'Local', 'Integration fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-01","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('ef200000-0000-4000-8000-000000000002',
   'ef000000-0000-4000-8000-000000000001',
   'ef100000-0000-4000-8000-000000000001',
   'Unreject wins cancellation race', 'Local', 'Integration fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-02","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming'),
  ('ef200000-0000-4000-8000-000000000003',
   'ef000000-0000-4000-8000-000000000001',
   'ef100000-0000-4000-8000-000000000001',
   'Inactive admin denied', 'Local', 'Integration fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-03","startTime":"10:00","endTime":"12:00","volunteers":10}}',
   true, 'upcoming');

INSERT INTO public.project_signups
  (id, project_id, user_id, schedule_id, status, created_at)
VALUES
  ('ef300000-0000-4000-8000-000000000001',
   'ef200000-0000-4000-8000-000000000001',
   'ef000000-0000-4000-8000-000000000002', 'oneTime', 'rejected', now()),
  ('ef300000-0000-4000-8000-000000000002',
   'ef200000-0000-4000-8000-000000000002',
   'ef000000-0000-4000-8000-000000000003', 'oneTime', 'rejected', now());

BEGIN;
SET LOCAL request.jwt.claims =
  '{"sub":"ef000000-0000-4000-8000-000000000004","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.cancel_project_transactional(
    'ef200000-0000-4000-8000-000000000003', 'Inactive attempt'
  )$$,
  '42501',
  'project cancellation permission denied',
  'inactive organization administrators are denied inside the cancellation RPC'
);
RESET ROLE;
COMMIT;

SELECT extensions.dblink_connect(
  'project_lifecycle_integration_probe',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec(
  'project_lifecycle_integration_probe',
  'SET ROLE authenticated'
);
SELECT extensions.dblink_exec(
  'project_lifecycle_integration_probe',
  'SET "request.jwt.claims" = ''{"sub":"ef000000-0000-4000-8000-000000000001","role":"authenticated"}'''
);

-- Cancellation holds the project boundary first. Atomic unreject must wait
-- without holding the signup row, then observe the cancelled project.
BEGIN;
SELECT 1
FROM public.projects
WHERE id = 'ef200000-0000-4000-8000-000000000001'
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'project_lifecycle_integration_probe',
  $$SELECT outcome, project_id
    FROM public.unreject_project_signup_with_capacity(
      'ef300000-0000-4000-8000-000000000001'
    )$$
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('project_lifecycle_integration_probe'),
  1,
  'unreject waits at the shared project boundary while cancellation owns it'
);

SET LOCAL request.jwt.claims =
  '{"sub":"ef000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  public.cancel_project_transactional(
    'ef200000-0000-4000-8000-000000000001', 'Cancellation won first'
  )->>'outcome',
  'cancelled',
  'the lock owner commits cancellation and its frozen audience atomically'
);
RESET ROLE;
COMMIT;

CREATE TEMP TABLE cancellation_first_unreject AS
SELECT *
FROM extensions.dblink_get_result(
  'project_lifecycle_integration_probe', false
) AS result(outcome text, project_id uuid);

SELECT extensions.is(
  (SELECT outcome FROM cancellation_first_unreject),
  'project_closed',
  'the waiting unreject refreshes project status and refuses approval'
);
SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'ef300000-0000-4000-8000-000000000001'),
  'rejected',
  'cancellation-first ordering never approves the rejected signup'
);
SELECT extensions.is(
  (SELECT recipient_count FROM public.project_cancellation_jobs
   WHERE project_id = 'ef200000-0000-4000-8000-000000000001'),
  0,
  'the cancellation-first snapshot excludes the refused approval'
);

-- Atomic unreject owns the same project boundary first. Cancellation waits,
-- then includes the committed approval in the frozen ledger.
BEGIN;
SET LOCAL request.jwt.claims =
  '{"sub":"ef000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  (SELECT outcome FROM public.unreject_project_signup_with_capacity(
    'ef300000-0000-4000-8000-000000000002'
  )),
  'approved',
  'atomic unreject can win the shared project boundary first'
);

SELECT extensions.dblink_send_query(
  'project_lifecycle_integration_probe',
  $$SELECT public.cancel_project_transactional(
    'ef200000-0000-4000-8000-000000000002', 'Approval won first'
  )::text$$
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('project_lifecycle_integration_probe'),
  1,
  'cancellation waits while atomic unreject owns the project boundary'
);
RESET ROLE;
COMMIT;

CREATE TEMP TABLE approval_first_cancellation AS
SELECT payload::jsonb
FROM extensions.dblink_get_result(
  'project_lifecycle_integration_probe'
) AS result(payload text);

SELECT extensions.is(
  (SELECT payload->>'outcome' FROM approval_first_cancellation),
  'cancelled',
  'the waiting cancellation succeeds after unreject commits'
);
SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'ef300000-0000-4000-8000-000000000002'),
  'approved',
  'approval-first ordering preserves the committed approval'
);
SELECT extensions.is(
  (SELECT recipient_count FROM public.project_cancellation_jobs
   WHERE project_id = 'ef200000-0000-4000-8000-000000000002'),
  1,
  'the waiting cancellation includes the committed approval exactly once'
);

SELECT extensions.dblink_disconnect('project_lifecycle_integration_probe');

DELETE FROM public.project_cancellation_jobs
WHERE project_id::text LIKE 'ef200000-0000-4000-8000-00000000000%';
DELETE FROM public.project_signups
WHERE project_id::text LIKE 'ef200000-0000-4000-8000-00000000000%';
DELETE FROM public.projects
WHERE id::text LIKE 'ef200000-0000-4000-8000-00000000000%';
DELETE FROM public.organization_members
WHERE organization_id = 'ef100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'ef100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id::text LIKE 'ef000000-0000-4000-8000-00000000000%';

SELECT * FROM extensions.finish();
