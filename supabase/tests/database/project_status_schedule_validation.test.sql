BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(14);

SELECT is((SELECT count(*) FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"","startTime":"09:00","endTime":"10:00"}}', 'UTC')),
  0::bigint, 'Blank dates have no invented timestamp');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-09-16","startTime":"","endTime":"10:00"}}', 'UTC')),
  0::bigint, 'Blank times have no invented default');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-02-30","startTime":"09:00","endTime":"10:00"}}', 'UTC')),
  0::bigint, 'Impossible dates are unresolved');
SELECT is((SELECT starts_at FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-09-16","startTime":"09:00","endTime":"10:00"}}', 'America/Los_Angeles')),
  '2026-09-16 16:00:00+00'::timestamptz, 'Summer times use the project timezone and daylight saving');
SELECT is((SELECT starts_at FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-01-16","startTime":"09:00","endTime":"10:00"}}', 'America/Los_Angeles')),
  '2026-01-16 17:00:00+00'::timestamptz, 'Winter times use standard time');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-03-08","startTime":"02:30","endTime":"04:00"}}', 'America/Los_Angeles')),
  0::bigint, 'Nonexistent daylight-saving wall time is unresolved');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('multiDay',
  '{"multiDay":[{"date":"2026-09-16","slots":[{"startTime":"09:00","endTime":"10:00"}]},{"date":"","slots":[{"startTime":"09:00","endTime":"10:00"}]}]}', 'UTC')),
  0::bigint, 'A malformed later day cannot produce premature completion');
SELECT is((SELECT ends_at FROM private.project_status_schedule_window('multiDay',
  '{"multiDay":[{"date":"2026-09-16","slots":[{"startTime":"09:00","endTime":"10:00"}]},{"date":"2026-09-17","slots":[{"startTime":"14:00","endTime":"15:00"}]}]}', 'UTC')),
  '2026-09-17 15:00:00+00'::timestamptz, 'Multi-day status includes the last slot');
SELECT is((SELECT starts_at FROM private.project_status_schedule_window('sameDayMultiArea',
  '{"sameDayMultiArea":{"date":"2026-09-16","overallStart":"09:00","overallEnd":"10:00","roles":[]}}', 'UTC')),
  '2026-09-16 09:00:00+00'::timestamptz, 'Same-day status follows the application overall window');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('multiDay',
  '{"multiDay":{}}', 'UTC')), 0::bigint, 'Malformed schedule containers are unresolved');
SELECT is((SELECT count(*) FROM private.project_status_schedule_window('oneTime',
  '{"oneTime":{"date":"2026-09-16","startTime":"09:00","endTime":"10:00"}}', 'Invalid/Zone')),
  0::bigint, 'Invalid timezones do not abort the maintenance job');
SELECT ok(NOT has_function_privilege('anon', 'public.process_projects()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.process_projects()', 'EXECUTE'),
  'Project status maintenance remains unavailable to client roles');
SELECT ok(NOT has_function_privilege('authenticated', 'private.project_status_schedule_window(text,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'private.project_status_schedule_window(text,jsonb,text)', 'EXECUTE'),
  'Schedule helper has explicit service-only permissions');

INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('71050000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'status-maintenance@local.test', '{}', '{}');
INSERT INTO public.projects(id, creator_id, title, location, description, event_type, verification_method, schedule, status, project_timezone)
VALUES
 ('71050000-0000-4000-8000-000000000002', '71050000-0000-4000-8000-000000000001', 'Incomplete schedule', 'Local', 'Synthetic', 'oneTime', 'manual', '{"oneTime":{"date":"","startTime":"","endTime":""}}', 'upcoming', 'UTC'),
 ('71050000-0000-4000-8000-000000000003', '71050000-0000-4000-8000-000000000001', 'Finished schedule', 'Local', 'Synthetic', 'oneTime', 'manual', '{"oneTime":{"date":"2020-01-01","startTime":"09:00","endTime":"10:00"}}', 'upcoming', 'UTC');
SELECT public.process_projects();
SELECT results_eq(
  $$SELECT status FROM public.projects WHERE id IN ('71050000-0000-4000-8000-000000000002','71050000-0000-4000-8000-000000000003') ORDER BY id$$,
  $$VALUES ('upcoming'::text),('completed'::text)$$,
  'Malformed project stays unchanged while a valid project completes in the same pass'
);
SELECT * FROM finish();
ROLLBACK;
