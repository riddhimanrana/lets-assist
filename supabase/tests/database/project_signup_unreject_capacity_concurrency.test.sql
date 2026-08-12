-- Two rejected signups racing for one remaining seat must serialize on the
-- same slot lock as every other capacity consumer. This file commits its
-- synthetic fixtures so a second real connection can observe the first.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(4);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ed000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'unreject-race-creator@local.test', now(), '{}', '{}', now(), now()),
  ('ed000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'unreject-race-one@local.test', now(), '{}', '{}', now(), now()),
  ('ed000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unreject-race-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001',
  'Concurrent atomic unreject fixture',
  'Local',
  'Two rejected signups race for one seat',
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
VALUES
  ('ed200000-0000-4000-8000-000000000001', 'ed100000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-000000000002', 'oneTime', 'rejected'),
  ('ed200000-0000-4000-8000-000000000002', 'ed100000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-000000000003', 'oneTime', 'rejected');

SELECT extensions.dblink_connect(
  'unreject_capacity_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec(
  'unreject_capacity_writer',
  'SET ROLE authenticated'
);
SELECT extensions.dblink_exec(
  'unreject_capacity_writer',
  'SET "request.jwt.claims" = ''{"sub":"ed000000-0000-4000-8000-000000000001","role":"authenticated"}'''
);

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ed000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.is(
  (
    SELECT transition.outcome
    FROM public.unreject_project_signup_with_capacity(
      'ed200000-0000-4000-8000-000000000001'
    ) AS transition
  ),
  'approved',
  'the first transaction consumes the only seat'
);

SELECT extensions.dblink_send_query(
  'unreject_capacity_writer',
  $$
    SELECT outcome, project_id
    FROM public.unreject_project_signup_with_capacity(
      'ed200000-0000-4000-8000-000000000002'::uuid
    )
  $$
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('unreject_capacity_writer'),
  1,
  'the concurrent approval waits on the canonical slot-capacity lock'
);

COMMIT;

CREATE TEMP TABLE unreject_capacity_result AS
SELECT *
FROM extensions.dblink_get_result('unreject_capacity_writer', false)
  AS result(outcome text, project_id uuid);

SELECT extensions.is(
  (SELECT outcome FROM unreject_capacity_result),
  'slot_full',
  'the waiting transaction re-counts after the winner commits and is refused'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'ed100000-0000-4000-8000-000000000001'
      AND schedule_id = 'oneTime'
      AND status IN ('approved', 'attended')
  ),
  1::bigint,
  'two concurrent unrejections leave active attendance at exactly capacity'
);

SELECT extensions.dblink_disconnect('unreject_capacity_writer');

DELETE FROM public.project_signups
WHERE project_id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM public.projects
WHERE id = 'ed100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'ed000000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000002',
  'ed000000-0000-4000-8000-000000000003'
);

SELECT * FROM extensions.finish();
