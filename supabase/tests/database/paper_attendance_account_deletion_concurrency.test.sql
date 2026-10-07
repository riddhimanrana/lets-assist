-- Only fictional, committed local rows participate in these independent sessions.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET statement_timeout = '10s';
SELECT extensions.plan(14);
INSERT INTO auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT ('ef810000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'paper-fence-race-' || n || '@local.test', now(), '{}', '{}', now(), now()
FROM generate_series(1, 2) n;
INSERT INTO public.projects(id, creator_id, title, location, description, event_type, verification_method, schedule, status, project_timezone)
VALUES ('ef820000-0000-4000-8000-000000000001', 'ef810000-0000-4000-8000-000000000001',
  'Paper deletion race', 'Local', 'Synthetic account lock ordering', 'oneTime', 'manual',
  '{"oneTime":{"date":"2020-09-01","startTime":"09:00","endTime":"17:00","volunteers":10}}', 'upcoming', 'UTC');
INSERT INTO public.anonymous_signups(id, project_id, email, name, token, confirmed_at)
VALUES ('ef830000-0000-4000-8000-000000000001', 'ef820000-0000-4000-8000-000000000001',
  'paper-fence-race-guest@local.test', 'Synthetic guest', 'ef840000-0000-4000-8000-000000000001', now());
SELECT extensions.dblink_connect('paper_actor_waiter',
  'hostaddr=' || host(inet_server_addr()) || ' port=' || current_setting('port') ||
  ' dbname=' || current_database() || ' user=' || current_user || ' password=' || current_user ||
  ' sslmode=disable options=' || quote_literal('-c statement_timeout=7000'));
SELECT extensions.dblink_exec('paper_actor_waiter', 'SET ROLE service_role');

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:ef810000-0000-4000-8000-000000000001', 0));
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
VALUES ('ef810000-0000-4000-8000-000000000001', 'ef810000-0000-4000-8000-000000000001', 'self_delete', 'external_pending');
SELECT extensions.dblink_send_query('paper_actor_waiter', $$SELECT public.create_attendance_print_sheets(
  'ef820000-0000-4000-8000-000000000001', ARRAY['oneTime'], 'ef810000-0000-4000-8000-000000000001',
  0, 0, 'ef850000-0000-4000-8000-000000000001')::text$$);
SELECT pg_sleep(0.15);
SELECT extensions.is(extensions.dblink_is_busy('paper_actor_waiter'), 1,
  'service print call waits for the account lock');
SELECT extensions.lives_ok($$SELECT id FROM public.projects
  WHERE id = 'ef820000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$$,
  'waiting print call has not taken the project lock');
COMMIT;
SELECT * FROM extensions.dblink_get_result('paper_actor_waiter', false) AS result(value text);
SELECT extensions.ok(extensions.dblink_error_message('paper_actor_waiter') LIKE '%Account deletion is pending or complete.%',
  'service print call rechecks deletion after its account lock wait');
SELECT count(*) FROM extensions.dblink_get_result('paper_actor_waiter') AS result(value text);
SELECT extensions.is((SELECT count(*) FROM public.project_attendance_print_sheets
  WHERE project_id = 'ef820000-0000-4000-8000-000000000001'), 0::bigint, 'denied actor created no sheets');
SELECT extensions.is((SELECT count(*) FROM private.attendance_print_requests
  WHERE request_id = 'ef850000-0000-4000-8000-000000000001'), 0::bigint, 'denied actor created no replay receipt');

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:ef810000-0000-4000-8000-000000000002', 0));
INSERT INTO app_private.account_deletion_operations(target_user_id, requested_by, mode, phase)
VALUES ('ef810000-0000-4000-8000-000000000002', 'ef810000-0000-4000-8000-000000000002', 'self_delete', 'external_pending');
SELECT extensions.dblink_send_query('paper_actor_waiter', $$SELECT public.link_guest_attendance_account(
  'ef830000-0000-4000-8000-000000000001', 'ef810000-0000-4000-8000-000000000002',
  'ef840000-0000-4000-8000-000000000001')::text$$);
SELECT pg_sleep(0.15);
SELECT extensions.is(extensions.dblink_is_busy('paper_actor_waiter'), 1,
  'service guest link waits for the destination account lock');
SELECT extensions.lives_ok($$SELECT id FROM public.projects
  WHERE id = 'ef820000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$$,
  'waiting guest link has not taken the project lock');
COMMIT;
SELECT * FROM extensions.dblink_get_result('paper_actor_waiter', false) AS result(value text);
SELECT extensions.ok(extensions.dblink_error_message('paper_actor_waiter') LIKE '%Account deletion is pending or complete.%',
  'guest link rechecks destination deletion after its lock wait');
SELECT count(*) FROM extensions.dblink_get_result('paper_actor_waiter') AS result(value text);
SELECT extensions.is((SELECT linked_user_id FROM public.anonymous_signups
  WHERE id = 'ef830000-0000-4000-8000-000000000001'), NULL::uuid, 'denied destination leaves the guest unclaimed');
SELECT extensions.is((SELECT count(*) FROM private.anonymous_account_links
  WHERE anonymous_id = 'ef830000-0000-4000-8000-000000000001'), 0::bigint, 'denied destination created no replay receipt');

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:ef810000-0000-4000-8000-000000000001', 0));
SELECT extensions.dblink_send_query('paper_actor_waiter', $$SELECT public.publish_volunteer_hours_transactional(
  'ef810000-0000-4000-8000-000000000001', 'ef820000-0000-4000-8000-000000000001',
  'oneTime', '[]', 'hours-publication:v1:' || repeat('a', 64))::text$$);
SELECT pg_sleep(0.15);
SELECT extensions.is(extensions.dblink_is_busy('paper_actor_waiter'), 1,
  'publication wrapper waits for the account lock');
SELECT extensions.lives_ok($$SELECT id FROM public.projects
  WHERE id = 'ef820000-0000-4000-8000-000000000001' FOR UPDATE NOWAIT$$,
  'publication wrapper has not taken the project lock before the account lock');
COMMIT;
SELECT * FROM extensions.dblink_get_result('paper_actor_waiter', false) AS result(value text);
SELECT extensions.ok(extensions.dblink_error_message('paper_actor_waiter') LIKE '%Account deletion is pending or complete.%',
  'publication wrapper rechecks the actor after its lock wait');
SELECT count(*) FROM extensions.dblink_get_result('paper_actor_waiter') AS result(value text);
SELECT extensions.is((SELECT count(*) FROM public.hours_publication_receipts
  WHERE project_id = 'ef820000-0000-4000-8000-000000000001'), 0::bigint, 'denied publication created no receipt');

SELECT extensions.dblink_disconnect('paper_actor_waiter');
DELETE FROM public.projects WHERE id = 'ef820000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id IN ('ef810000-0000-4000-8000-000000000001', 'ef810000-0000-4000-8000-000000000002');
DELETE FROM app_private.account_deletion_operations
  WHERE target_user_id IN ('ef810000-0000-4000-8000-000000000001', 'ef810000-0000-4000-8000-000000000002');
SELECT * FROM extensions.finish();
RESET statement_timeout;
