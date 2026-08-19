-- Two-session proof that approved-to-attended transitions share the project
-- boundary with cancellation.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(3);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('f9400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'attendance-lock-owner@local.test', now(), '{}', '{}', now(), now()),
  ('f9400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'attendance-lock-volunteer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'f9500000-0000-4000-8000-000000000001',
  'f9400000-0000-4000-8000-000000000001',
  'Attendance cancellation lock',
  'Local',
  'Concurrency review fixture',
  'oneTime',
  'manual',
  '{"oneTime":{"date":"2031-08-16","startTime":"10:00","endTime":"12:00","volunteers":10}}',
  true,
  'upcoming'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'f9600000-0000-4000-8000-000000000001',
  'f9500000-0000-4000-8000-000000000001',
  'f9400000-0000-4000-8000-000000000002',
  'oneTime',
  'approved'
);

SELECT extensions.dblink_connect(
  'attendance_cancellation_lock_probe',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec(
  'attendance_cancellation_lock_probe',
  'SET ROLE service_role'
);

BEGIN;
SELECT 1
FROM public.projects
WHERE id = 'f9500000-0000-4000-8000-000000000001'
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'attendance_cancellation_lock_probe',
  $$UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'f9600000-0000-4000-8000-000000000001'
    RETURNING id$$
);
SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('attendance_cancellation_lock_probe'),
  1,
  'attendance waits while cancellation owns the shared project boundary'
);

UPDATE public.projects
SET status = 'cancelled'
WHERE id = 'f9500000-0000-4000-8000-000000000001';
COMMIT;

SELECT *
FROM extensions.dblink_get_result(
  'attendance_cancellation_lock_probe',
  false
) AS result(id uuid);

SELECT extensions.ok(
  position(
    'attendance requires an active project'
    IN extensions.dblink_error_message('attendance_cancellation_lock_probe')
  ) > 0,
  'the waiting attendance transition rejects the committed cancellation'
);
SELECT extensions.is(
  (SELECT status FROM public.project_signups
   WHERE id = 'f9600000-0000-4000-8000-000000000001'),
  'approved',
  'the cancelled-project rejection preserves approved signup state'
);

SELECT extensions.dblink_disconnect('attendance_cancellation_lock_probe');

DELETE FROM public.project_signups
WHERE id = 'f9600000-0000-4000-8000-000000000001';
DELETE FROM public.projects
WHERE id = 'f9500000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'f9400000-0000-4000-8000-000000000001',
  'f9400000-0000-4000-8000-000000000002'
);

SELECT * FROM extensions.finish();
