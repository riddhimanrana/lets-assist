-- Bounded service-only candidate rotation for post-project feedback enqueue.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

SELECT extensions.is(
  (
    SELECT pg_get_userbyid(proowner)
    FROM pg_proc
    WHERE oid = 'private.project_feedback_candidate_end_date(text,jsonb)'::regprocedure
  ),
  'postgres',
  'candidate date helper is owned by postgres'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'private.project_feedback_candidate_end_date(text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.project_feedback_candidate_end_date(text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'private.project_feedback_candidate_end_date(text,jsonb)',
    'EXECUTE'
  ),
  'only the service role can execute the candidate date helper'
);

SELECT extensions.ok(
  NOT has_table_privilege(
    'anon', 'public.project_feedback_candidate_read_model', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.project_feedback_candidate_read_model', 'SELECT'
  )
  AND has_table_privilege(
    'service_role', 'public.project_feedback_candidate_read_model', 'SELECT'
  ),
  'only the service role can select the candidate read model'
);

SELECT extensions.ok(
  (
    SELECT reloptions @> ARRAY['security_invoker=true', 'security_barrier=true']
    FROM pg_class
    WHERE oid = 'public.project_feedback_candidate_read_model'::regclass
  ),
  'candidate read model invokes with the caller and is a security barrier'
);

SELECT extensions.has_index(
  'public',
  'projects',
  'projects_feedback_candidate_end_date_idx',
  'completed candidate dates have an index for the bounded worker query'
);

SELECT extensions.is(
  private.project_feedback_candidate_end_date(
    'oneTime',
    '{"oneTime":{"date":"2026-08-17"}}'::jsonb
  ),
  '2026-08-17'::date,
  'one-time schedules expose their event date'
);

SELECT extensions.is(
  private.project_feedback_candidate_end_date(
    'multiDay',
    '{"multiDay":[{"date":"2026-08-17"},{"date":"2026-08-19"}]}'::jsonb
  ),
  '2026-08-19'::date,
  'multi-day schedules expose their final event date'
);

SELECT extensions.is(
  private.project_feedback_candidate_end_date(
    'oneTime',
    '{"oneTime":{"date":"not-a-date"}}'::jsonb
  ),
  NULL::date,
  'malformed schedules fail closed outside the candidate set'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('d9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'candidate-creator@local.test', now(), '{}', '{"username":"candidate_creator"}', now(), now()),
  ('d9000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'candidate-attendee@local.test', now(), '{}', '{"username":"candidate_attendee"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'd9100000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'Candidate fixture', 'Local', 'Candidate fixture', 'oneTime', 'manual',
  '{"oneTime":{"date":"2026-08-17","startTime":"10:00","endTime":"12:00","volunteers":10}}'::jsonb,
  true, 'completed'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, anonymous_id, schedule_id, status
)
VALUES (
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000002',
  NULL, 'oneTime', 'attended'
);

SELECT extensions.is(
  (
    SELECT candidate_end_date
    FROM public.project_feedback_candidate_read_model
    WHERE id = 'd9100000-0000-4000-8000-000000000001'
  ),
  '2026-08-17'::date,
  'an attended identity without a queue row is a candidate'
);

INSERT INTO public.project_feedback_requests (
  project_id, signup_id, user_id, anonymous_id,
  recipient_email_hash, eligible_at
)
VALUES (
  'd9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000002',
  NULL, repeat('a', 64), now()
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_feedback_candidate_read_model
    WHERE id = 'd9100000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a fully represented project leaves the rotating candidate set'
);

SELECT * FROM extensions.finish();

ROLLBACK;
