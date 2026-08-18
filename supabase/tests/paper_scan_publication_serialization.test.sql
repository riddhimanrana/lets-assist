BEGIN;

SELECT plan(17);

SELECT has_function(
  'app_private',
  'lock_paper_scan_project_for_commit',
  ARRAY[]::text[],
  'paper scan commit lock trigger function exists'
);
SELECT has_function(
  'app_private',
  'guard_hours_publication_completeness',
  ARRAY[]::text[],
  'publication completeness trigger function exists'
);
SELECT has_trigger(
  'public',
  'project_paper_scan_batches',
  'lock_paper_scan_project_for_commit',
  'paper scan batches lock their parent project before commit'
);
SELECT has_trigger(
  'public',
  'projects',
  'guard_hours_publication_completeness',
  'projects reject incomplete publication snapshots'
);
SELECT function_privs_are(
  'app_private',
  'lock_paper_scan_project_for_commit',
  ARRAY[]::text[],
  'postgres',
  ARRAY['EXECUTE'],
  'postgres can execute the paper commit lock trigger'
);
SELECT function_privs_are(
  'app_private',
  'guard_hours_publication_completeness',
  ARRAY[]::text[],
  'postgres',
  ARRAY['EXECUTE'],
  'postgres can execute the publication guard trigger'
);
SELECT function_privs_are(
  'app_private',
  'lock_paper_scan_project_for_commit',
  ARRAY[]::text[],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute the paper commit lock trigger'
);
SELECT function_privs_are(
  'app_private',
  'guard_hours_publication_completeness',
  ARRAY[]::text[],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute the publication guard trigger'
);

SELECT has_function(
  'app_private',
  'issue_verified_certificate_for_late_attendance',
  ARRAY[]::text[],
  'late attendance certificate trigger function exists'
);
SELECT has_trigger(
  'public',
  'project_signups',
  'issue_verified_certificate_for_late_attendance',
  'late attendance is reconciled in its own transaction'
);
SELECT function_privs_are(
  'app_private',
  'issue_verified_certificate_for_late_attendance',
  ARRAY[]::text[],
  'postgres',
  ARRAY['EXECUTE'],
  'postgres can execute the late attendance certificate trigger'
);
SELECT function_privs_are(
  'app_private',
  'issue_verified_certificate_for_late_attendance',
  ARRAY[]::text[],
  'authenticated',
  ARRAY[]::text[],
  'authenticated cannot execute the late attendance certificate trigger'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'ac000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'publication-race@local.test',
    now(),
    '{}',
    '{"full_name":"Publication Race Fixture"}',
    now(),
    now()
  ),
  (
    'ac000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'late-attendance@local.test',
    now(),
    '{}',
    '{"full_name":"Late Attendance Fixture"}',
    now(),
    now()
  );

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login
)
VALUES (
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'Publication serialization fixture',
  'Local',
  'Synthetic publication race fixture',
  'oneTime',
  'manual',
  '{"oneTime":{"date":"2030-08-18","startTime":"09:00","endTime":"12:00","volunteers":5}}',
  true
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status, check_in_time, check_out_time
)
VALUES (
  'ac200000-0000-4000-8000-000000000001',
  'ac100000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'oneTime',
  'attended',
  '2030-08-18T16:00:00Z',
  '2030-08-18T18:00:00Z'
);

SELECT throws_ok(
  $$UPDATE public.projects
    SET published = '{"oneTime":true}'::jsonb
    WHERE id = 'ac100000-0000-4000-8000-000000000001'$$,
  'P0001',
  'publication snapshot is stale; refresh attendance before publishing',
  'publication fails closed when eligible committed attendance lacks a verified certificate'
);

INSERT INTO public.certificates (
  project_title, is_certified, event_start, event_end, check_in_method,
  project_id, schedule_id, signup_id, type
)
VALUES (
  'Publication serialization fixture',
  true,
  '2030-08-18T16:00:00Z',
  '2030-08-18T18:00:00Z',
  'manual',
  'ac100000-0000-4000-8000-000000000001',
  'oneTime',
  'ac200000-0000-4000-8000-000000000001',
  'verified'
);

SELECT lives_ok(
  $$UPDATE public.projects
    SET published = '{"oneTime":true}'::jsonb
    WHERE id = 'ac100000-0000-4000-8000-000000000001'$$,
  'publication succeeds after every eligible attendance row has a verified certificate'
);

SELECT results_eq(
  $$SELECT published ->> 'oneTime'
    FROM public.projects
    WHERE id = 'ac100000-0000-4000-8000-000000000001'$$,
  $$VALUES ('true'::text)$$,
  'the successful guarded publication persists the session state'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, published
)
VALUES (
  'ac100000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000001',
  'Late attendance serialization fixture',
  'Local',
  'Synthetic already-published fixture',
  'oneTime',
  'manual',
  '{"oneTime":{"date":"2030-08-19","startTime":"09:00","endTime":"12:00","volunteers":5}}',
  true,
  '{"oneTime":true}'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status, check_in_time, check_out_time
)
VALUES (
  'ac200000-0000-4000-8000-000000000002',
  'ac100000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000001',
  'oneTime',
  'attended',
  '2030-08-19T16:00:00Z',
  '2030-08-19T18:00:00Z'
);

SELECT results_eq(
  $$SELECT count(*)
    FROM public.certificates
    WHERE signup_id = 'ac200000-0000-4000-8000-000000000002'
      AND type = 'verified'$$,
  $$VALUES (1::bigint)$$,
  'an inserted late attendance row commits its verified certificate atomically'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'ac200000-0000-4000-8000-000000000003',
  'ac100000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000002',
  'oneTime',
  'approved'
);

UPDATE public.project_signups
SET
  status = 'attended',
  check_in_time = '2030-08-19T16:15:00Z',
  check_out_time = '2030-08-19T18:15:00Z'
WHERE id = 'ac200000-0000-4000-8000-000000000003';

SELECT results_eq(
  $$SELECT count(*)
    FROM public.certificates
    WHERE signup_id = 'ac200000-0000-4000-8000-000000000003'
      AND type = 'verified'$$,
  $$VALUES (1::bigint)$$,
  'an updated late attendance row commits its verified certificate atomically'
);

SELECT * FROM finish();
ROLLBACK;
