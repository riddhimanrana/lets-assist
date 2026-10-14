-- Future fictional sessions qualify for the worker's row-selection predicate
-- but cannot accrue attendance. A 500ms deadline proves both SKIP LOCKED paths
-- without waiting for wall-clock attendance or racing the background scheduler.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('ad724200-0000-4000-8000-000000000001','authenticated','authenticated','worker-lock-owner@local.test','{}','{}'),
 ('ad724200-0000-4000-8000-000000000002','authenticated','authenticated','worker-lock-volunteer@local.test','{}','{}');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,project_timezone,status)
VALUES ('ad724300-0000-4000-8000-000000000001','ad724200-0000-4000-8000-000000000001',
 'Fictional worker lock','Local','Synthetic concurrency regression','oneTime','auto',
 '{"oneTime":{"date":"2999-01-15","startTime":"10:00","endTime":"12:00","volunteers":10}}','UTC','upcoming');
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status)
VALUES ('ad724400-0000-4000-8000-000000000001','ad724300-0000-4000-8000-000000000001',
 'ad724200-0000-4000-8000-000000000002','oneTime','approved');

SELECT extensions.dblink_connect('scheduled_worker_lock',
 'hostaddr=' || host(inet_server_addr()) || ' port=' || current_setting('port') ||
 ' dbname=' || current_database() || ' user=' || current_user ||
 ' password=' || current_user || ' sslmode=disable');
SELECT extensions.dblink_exec('scheduled_worker_lock','SET ROLE service_role');
SELECT extensions.dblink_exec('scheduled_worker_lock','SET statement_timeout=''500ms''');

BEGIN;
SELECT id FROM public.projects WHERE id='ad724300-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.lives_ok($test$
 SELECT * FROM extensions.dblink('scheduled_worker_lock','SELECT public.process_automatic_check_ins()') AS result(done text)
$test$,'scheduled check-in skips the project boundary held by another session');
SELECT extensions.ok((SELECT status='approved' AND check_in_time IS NULL AND check_out_time IS NULL
 FROM public.project_signups WHERE id='ad724400-0000-4000-8000-000000000001'),
 'skipped project retains its original attendance state');
COMMIT;

UPDATE public.project_signups SET status='attended',check_in_time='2999-01-15 10:15:00+00'
WHERE id='ad724400-0000-4000-8000-000000000001';
BEGIN;
SELECT id FROM public.project_signups WHERE id='ad724400-0000-4000-8000-000000000001' FOR UPDATE;
SELECT extensions.lives_ok($test$
 SELECT * FROM extensions.dblink('scheduled_worker_lock','SELECT public.process_automatic_check_outs()') AS result(done text)
$test$,'scheduled checkout skips an attendance row held by another session');
SELECT extensions.ok((SELECT check_in_time='2999-01-15 10:15:00+00'::timestamptz AND check_out_time IS NULL
 FROM public.project_signups WHERE id='ad724400-0000-4000-8000-000000000001'),
 'skipped signup preserves its recorded arrival without inventing checkout');
COMMIT;

SELECT extensions.dblink_disconnect('scheduled_worker_lock');
DELETE FROM public.project_signups WHERE id='ad724400-0000-4000-8000-000000000001';
DELETE FROM public.projects WHERE id='ad724300-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id IN ('ad724200-0000-4000-8000-000000000001','ad724200-0000-4000-8000-000000000002');
SELECT * FROM extensions.finish();
