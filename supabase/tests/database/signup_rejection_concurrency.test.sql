-- Two requests rejecting the same signup must serialize on the project/signup
-- lock order. This file commits synthetic fixtures so a second real connection
-- can observe the first transaction.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(5);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'rejection-race-creator@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'rejection-race-volunteer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'Concurrent rejection fixture',
  'Local',
  'Two requests race to reject one signup',
  'oneTime',
  'manual',
  jsonb_build_object(
    'oneTime',
    jsonb_build_object(
      'date', to_char(
        (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '2 day',
        'YYYY-MM-DD'
      ),
      'startTime', '10:00',
      'endTime', '12:00',
      'volunteers', 1
    )
  ),
  true,
  'upcoming'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000002',
  'oneTime',
  'pending'
);

SELECT extensions.dblink_connect(
  'signup_rejection_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec(
  'signup_rejection_writer',
  'SET ROLE authenticated'
);
SELECT extensions.dblink_exec(
  'signup_rejection_writer',
  'SET "request.jwt.claims" = ''{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}'''
);

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE first_rejection AS
SELECT public.reject_project_signup(
  'fa200000-0000-4000-8000-000000000001'
) AS result;

SELECT extensions.is(
  (SELECT result ->> 'outcome' FROM first_rejection),
  'accepted',
  'the first request owns the rejection transition'
);

SELECT extensions.dblink_send_query(
  'signup_rejection_writer',
  $$
    SELECT public.reject_project_signup(
      'fa200000-0000-4000-8000-000000000001'::uuid
    ) ->> 'outcome'
  $$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('signup_rejection_writer'),
  1,
  'the concurrent request waits for the project/signup transaction'
);

COMMIT;

CREATE TEMP TABLE concurrent_rejection_result AS
SELECT *
FROM extensions.dblink_get_result('signup_rejection_writer', false)
  AS result(outcome text);

SELECT extensions.is(
  (SELECT outcome FROM concurrent_rejection_result),
  'replayed',
  'the waiting request re-reads the committed rejection as a replay'
);
SELECT extensions.is(
  (
    SELECT status
    FROM public.project_signups
    WHERE id = 'fa200000-0000-4000-8000-000000000001'
  ),
  'rejected',
  'the serialized calls leave the signup rejected'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.notifications
    WHERE data ->> 'signupId' = 'fa200000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the serialized calls create exactly one intentional notification'
);

SELECT extensions.dblink_disconnect('signup_rejection_writer');

DELETE FROM public.notifications
WHERE data ->> 'signupId' = 'fa200000-0000-4000-8000-000000000001';
DELETE FROM public.project_signups
WHERE id = 'fa200000-0000-4000-8000-000000000001';
DELETE FROM public.projects
WHERE id = 'fa100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'fa000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000002'
);

SELECT * FROM extensions.finish();
