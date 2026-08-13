-- Two-session proof that recurrence materialization takes the same parent-row
-- boundary as series ending. A generator queued behind the committed end state
-- must fail instead of inserting one final stale child.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(3);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'fa400000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'recurrence-serialization-owner@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status, recurrence_rule
)
VALUES (
  'fa500000-0000-4000-8000-000000000001',
  'fa400000-0000-4000-8000-000000000001',
  'Recurrence serialization parent',
  'Local',
  'Concurrency fixture',
  'oneTime',
  'manual',
  '{"oneTime":{"date":"2032-08-20","startTime":"10:00","endTime":"11:00","volunteers":5}}',
  true,
  'upcoming',
  '{"frequency":"weekly","interval":1,"end_type":"never"}'
);

SELECT extensions.dblink_connect(
  'recurrence_parent_serialization_probe',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec(
  'recurrence_parent_serialization_probe',
  'SET ROLE service_role'
);

BEGIN;
SELECT 1
FROM public.projects
WHERE id = 'fa500000-0000-4000-8000-000000000001'
FOR UPDATE;

SELECT extensions.dblink_send_query(
  'recurrence_parent_serialization_probe',
  $$INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, status,
      recurrence_parent_id, recurrence_sequence, recurrence_occurrence_date
    ) VALUES (
      'fa500000-0000-4000-8000-000000000002',
      'fa400000-0000-4000-8000-000000000001',
      'Queued stale occurrence',
      'Local',
      'Concurrency fixture',
      'oneTime',
      'manual',
      '{"oneTime":{"date":"2032-08-27","startTime":"10:00","endTime":"11:00","volunteers":5}}',
      true,
      'upcoming',
      'fa500000-0000-4000-8000-000000000001',
      1,
      '2032-08-27'
    )
    RETURNING id$$
);
SELECT pg_sleep(0.25);

SELECT extensions.is(
  extensions.dblink_is_busy('recurrence_parent_serialization_probe'),
  1,
  'recurrence generation waits while series ending owns the parent row'
);

UPDATE public.projects
SET recurrence_rule = NULL
WHERE id = 'fa500000-0000-4000-8000-000000000001';
COMMIT;

SELECT *
FROM extensions.dblink_get_result(
  'recurrence_parent_serialization_probe',
  false
) AS result(id uuid);

SELECT extensions.ok(
  position(
    'recurrence parent is no longer active'
    IN extensions.dblink_error_message('recurrence_parent_serialization_probe')
  ) > 0,
  'the queued generator rejects the committed series end'
);
SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.projects
    WHERE id = 'fa500000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the rejected generator creates no stale occurrence'
);

SELECT extensions.dblink_disconnect('recurrence_parent_serialization_probe');

DELETE FROM public.projects
WHERE id = 'fa500000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id = 'fa400000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
