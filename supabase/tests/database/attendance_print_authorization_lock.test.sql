CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('cf100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','print-lock-'||n||'@local.test',now(),'{}',jsonb_build_object('username','print_lock_'||n,'full_name','Protected volunteer '||n),now(),now() FROM generate_series(1,3) n;
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES('cf200000-0000-4000-8000-000000000001','Print authorization race','print_authorization_race','nonprofit','639311');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000002','admin','active');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,organization_id,can_be_managed_by_staff)
VALUES('cf300000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','Protected print fixture','Local','Synthetic print authorization race','sameDayMultiArea','manual','{"sameDayMultiArea":{"date":"2020-09-18","roles":[{"name":"Morning","startTime":"09:00","endTime":"10:00","volunteers":10},{"name":"Afternoon","startTime":"11:00","endTime":"12:00","volunteers":10}]}}','upcoming','UTC','cf200000-0000-4000-8000-000000000001',false);
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES('cf400000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000003','Morning','approved');
SELECT extensions.dblink_connect('attendance_print_waiter','hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('attendance_print_waiter','SET application_name=''attendance_print_waiter''; SET statement_timeout=''10s''');
CREATE FUNCTION pg_temp.wait_for_print_lock() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 FOR attempt IN 1..50 LOOP
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='attendance_print_waiter' AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid))) THEN RETURN true; END IF;
  PERFORM pg_sleep(0.05);
 END LOOP;
 RETURN false;
END; $$;

BEGIN;
SELECT id FROM public.projects WHERE id='cf300000-0000-4000-8000-000000000001' FOR UPDATE;
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002';
SELECT extensions.dblink_send_query('attendance_print_waiter',$$SELECT public.create_attendance_print_sheet('cf300000-0000-4000-8000-000000000001','Morning','cf100000-0000-4000-8000-000000000002',0,0)$$);
SELECT extensions.ok(pg_temp.wait_for_print_lock(),'single-sheet print waits for the project boundary while revocation is pending');
COMMIT;
SELECT * FROM extensions.dblink_get_result('attendance_print_waiter',false) AS result(id uuid);
SELECT extensions.ok(position('Not authorized to print this project' IN extensions.dblink_error_message('attendance_print_waiter'))>0,'waiting print rechecks the committed membership revocation');
SELECT * FROM extensions.dblink_get_result('attendance_print_waiter',false) AS result(id uuid);
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='cf300000-0000-4000-8000-000000000001'),0,'revocation winning the project boundary creates no sheet');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_rows WHERE project_id='cf300000-0000-4000-8000-000000000001'),0,'revocation winning the project boundary snapshots no roster names');

UPDATE public.organization_members SET status='active' WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002';
CREATE TEMP TABLE print_results(kind text,value jsonb);
BEGIN;
INSERT INTO print_results SELECT 'admin',public.create_attendance_print_sheets('cf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'cf100000-0000-4000-8000-000000000002',0,0,'cf500000-0000-4000-8000-000000000001');
SELECT extensions.dblink_send_query('attendance_print_waiter',$$UPDATE public.organization_members SET status='inactive' WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002' RETURNING status$$);
SELECT extensions.ok(pg_temp.wait_for_print_lock(),'print winning authorization holds the membership until all sheets commit');
COMMIT;
SELECT extensions.is(status,'inactive','waiting revocation completes after the authorized print commits') FROM extensions.dblink_get_result('attendance_print_waiter') AS result(status text);
SELECT * FROM extensions.dblink_get_result('attendance_print_waiter') AS result(status text);
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='cf300000-0000-4000-8000-000000000001'),2,'authorized multi-sheet print commits both snapshots before revocation');
SELECT extensions.throws_ok($$SELECT public.create_attendance_print_sheets('cf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'cf100000-0000-4000-8000-000000000002',0,0,'cf500000-0000-4000-8000-000000000001')$$,'42501','Not authorized to print this project','revoked actor cannot replay the just-committed request');

BEGIN;
INSERT INTO print_results SELECT 'owner',public.create_attendance_print_sheets('cf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'cf100000-0000-4000-8000-000000000001',0,0,'cf500000-0000-4000-8000-000000000002');
SELECT extensions.dblink_send_query('attendance_print_waiter',$$SELECT public.create_attendance_print_sheets('cf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'cf100000-0000-4000-8000-000000000001',0,0,'cf500000-0000-4000-8000-000000000002')$$);
SELECT extensions.ok(pg_temp.wait_for_print_lock(),'concurrent identical request waits for the first request transaction');
COMMIT;
SELECT extensions.is(value,(SELECT value FROM print_results WHERE kind='owner'),'concurrent retry returns identical sheet references') FROM extensions.dblink_get_result('attendance_print_waiter') AS result(value jsonb);
SELECT * FROM extensions.dblink_get_result('attendance_print_waiter') AS result(value jsonb);
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='cf300000-0000-4000-8000-000000000001'),4,'two successful requests create four sheets despite concurrent retry');
SELECT extensions.is((SELECT count(*)::integer FROM private.attendance_print_requests WHERE project_id='cf300000-0000-4000-8000-000000000001'),2,'concurrent retry retains exactly one receipt per successful request');

UPDATE public.organization_members SET status='active' WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002';
BEGIN;
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cf200000-0000-4000-8000-000000000001' AND user_id='cf100000-0000-4000-8000-000000000002';
SELECT extensions.dblink_send_query('attendance_print_waiter',$$SELECT public.create_attendance_print_sheets('cf300000-0000-4000-8000-000000000001',ARRAY['Morning','Afternoon'],'cf100000-0000-4000-8000-000000000002',0,0,'cf500000-0000-4000-8000-000000000003')$$);
SELECT extensions.ok(pg_temp.wait_for_print_lock(),'print also waits for membership-only revocation without a project update');
COMMIT;
SELECT * FROM extensions.dblink_get_result('attendance_print_waiter',false) AS result(value jsonb);
SELECT extensions.ok(position('Not authorized to print this project' IN extensions.dblink_error_message('attendance_print_waiter'))>0,'membership-only revocation denies the waiting multi-sheet request');
SELECT extensions.is((SELECT count(*)::integer FROM private.attendance_print_requests WHERE request_id='cf500000-0000-4000-8000-000000000003'),0,'denied waiting request leaves no receipt');
SELECT extensions.is((SELECT count(*)::integer FROM public.project_attendance_print_sheets WHERE project_id='cf300000-0000-4000-8000-000000000001'),4,'denied waiting request leaves no extra manifest');
SELECT extensions.is((SELECT status FROM public.project_signups WHERE id='cf400000-0000-4000-8000-000000000001'),'approved','printing races never alter attendance');
SELECT extensions.dblink_disconnect('attendance_print_waiter');
DELETE FROM public.projects WHERE id='cf300000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members WHERE organization_id='cf200000-0000-4000-8000-000000000001';
DELETE FROM public.organizations WHERE id='cf200000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id IN('cf100000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000002','cf100000-0000-4000-8000-000000000003');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.project_attendance_print_sheets WHERE project_id='cf300000-0000-4000-8000-000000000001') AND NOT EXISTS(SELECT 1 FROM private.attendance_print_requests WHERE project_id='cf300000-0000-4000-8000-000000000001'),'concurrency fixtures and private receipts are removed');
SELECT * FROM extensions.finish();
