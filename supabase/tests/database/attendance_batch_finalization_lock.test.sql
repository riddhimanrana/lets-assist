-- Separate committed fixtures let both connections observe the same batch.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(9);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES('be100000-0000-4000-8000-000000000001','authenticated','authenticated','batch-finalization-race@local.test',now(),'{}','{"username":"batch_finalization_race"}',now(),now());
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,published)
SELECT ('be200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'be100000-0000-4000-8000-000000000001','Batch finalization race','Local','Synthetic concurrent exclusion','oneTime','manual','{"oneTime":{"date":"2020-09-18","startTime":"09:00","endTime":"12:00","volunteers":10}}','upcoming','UTC','{"oneTime":true}' FROM generate_series(1,2) n;
INSERT INTO public.project_paper_scan_batches(id,project_id,schedule_id,created_by,status,image_count)
SELECT ('be300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('be200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'oneTime','be100000-0000-4000-8000-000000000001','review',1 FROM generate_series(1,2) n;
INSERT INTO public.project_paper_scan_rows(id,batch_id,project_id,sheet_row_number,raw_extraction,name,email,decision,attendance_intervals,review_acknowledged,identity_confirmed)
SELECT ('be400000-0000-4000-8000-'||lpad((batch*10+slot)::text,12,'0'))::uuid,('be300000-0000-4000-8000-'||lpad(batch::text,12,'0'))::uuid,('be200000-0000-4000-8000-'||lpad(batch::text,12,'0'))::uuid,slot,'{}','Concurrent volunteer',CASE WHEN slot=1 THEN 'batch-race-'||batch||'@local.test' ELSE NULL END,'include',CASE WHEN slot=1 THEN '[{"checkIn":"2020-09-18T09:00:00Z","checkOut":"2020-09-18T10:00:00Z"}]'::jsonb ELSE '[{"checkIn":"2020-09-18T09:00:00Z","checkOut":null}]'::jsonb END,true,true
FROM generate_series(1,2) batch CROSS JOIN generate_series(1,3) slot;
SELECT result.outcome FROM public.project_paper_scan_batches b CROSS JOIN LATERAL public.commit_paper_signup_batch(b.id,'be100000-0000-4000-8000-000000000001',ARRAY(SELECT r.id FROM public.project_paper_scan_rows r WHERE r.batch_id=b.id ORDER BY r.sheet_row_number),false,gen_random_uuid()) result WHERE b.id IN('be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002');
CREATE TEMP TABLE race_awards AS SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) AS value FROM public.certificates c WHERE c.project_id IN('be200000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000002');
SELECT extensions.dblink_connect('batch_finalize_waiter','hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('batch_finalize_waiter','SET application_name=''batch_finalize_waiter''; SET statement_timeout=''10s''; SET ROLE service_role');
CREATE FUNCTION pg_temp.wait_for_batch_lock() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 FOR attempt IN 1..50 LOOP
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='batch_finalize_waiter' AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid))) THEN RETURN true; END IF;
  PERFORM pg_sleep(0.05);
 END LOOP;
 RETURN false;
END; $$;
BEGIN;
SELECT public.update_paper_scan_review_row('be300000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000012','be100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.dblink_send_query('batch_finalize_waiter',$$SELECT public.update_paper_scan_review_row('be300000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000013','be100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}')$$);
SELECT extensions.ok(pg_temp.wait_for_batch_lock(),'second exclusion waits on the batch lock held by the first');
COMMIT;
SELECT extensions.is(result,'updated','waiting exclusion succeeds after the first commits') FROM extensions.dblink_get_result('batch_finalize_waiter') AS result(result text);
SELECT * FROM extensions.dblink_get_result('batch_finalize_waiter') AS result(result text);
SELECT extensions.is((SELECT status FROM public.project_paper_scan_batches WHERE id='be300000-0000-4000-8000-000000000001'),'committed','serialized exclusions observe both decisions and finalize once');
SELECT extensions.is((SELECT sum(review_revision)::integer FROM public.project_paper_scan_rows WHERE id IN('be400000-0000-4000-8000-000000000012','be400000-0000-4000-8000-000000000013')),2,'each concurrent exclusion advances only its own revision');

SELECT public.update_paper_scan_review_row('be300000-0000-4000-8000-000000000002','be200000-0000-4000-8000-000000000002','be400000-0000-4000-8000-000000000022','be100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}');
BEGIN;
SELECT public.update_paper_scan_review_row('be300000-0000-4000-8000-000000000002','be200000-0000-4000-8000-000000000002','be400000-0000-4000-8000-000000000023','be100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"exclude"}');
SELECT extensions.dblink_send_query('batch_finalize_waiter',$$SELECT public.update_paper_scan_review_row('be300000-0000-4000-8000-000000000002','be200000-0000-4000-8000-000000000002','be400000-0000-4000-8000-000000000023','be100000-0000-4000-8000-000000000001','{"expectedRevision":0,"decision":"include"}')$$);
SELECT extensions.ok(pg_temp.wait_for_batch_lock(),'same-row contender waits until the winning exclusion commits');
COMMIT;
SELECT * FROM extensions.dblink_get_result('batch_finalize_waiter',false) AS result(result text);
SELECT extensions.ok(position('review row changed; refresh before saving' IN extensions.dblink_error_message('batch_finalize_waiter'))>0,'waiting stale edit fails after terminal transition');
SELECT extensions.ok((SELECT b.status='committed' AND r.review_revision=1 AND r.decision='exclude' FROM public.project_paper_scan_batches b JOIN public.project_paper_scan_rows r ON r.batch_id=b.id WHERE r.id='be400000-0000-4000-8000-000000000023'),'stale contender cannot reopen or overwrite the final decision');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.certificates c WHERE c.project_id IN('be200000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000002')),(SELECT value FROM race_awards),'both races preserve the complete existing awards');
SELECT extensions.dblink_disconnect('batch_finalize_waiter');
DELETE FROM public.certificates WHERE project_id IN('be200000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000002');
DELETE FROM public.projects WHERE id IN('be200000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000002');
DELETE FROM auth.users WHERE id='be100000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.project_paper_scan_batches WHERE id IN('be300000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000002'))
 AND NOT EXISTS(SELECT 1 FROM public.certificates WHERE volunteer_email IN('batch-race-1@local.test','batch-race-2@local.test'))
 AND NOT EXISTS(SELECT 1 FROM public.anonymous_signups WHERE email IN('batch-race-1@local.test','batch-race-2@local.test'))
 AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='be100000-0000-4000-8000-000000000001'),'committed concurrency fixtures and award snapshots are removed');
SELECT * FROM extensions.finish();
