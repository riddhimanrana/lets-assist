-- Fictional committed fixtures support independent dblink transactions.
-- The isolated replay owns and removes this database after the suite.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cf000000-0000-4000-8000-000000000001','authenticated','authenticated','rebuild-race@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cf100000-0000-4000-8000-000000000001','Rebuild race fixture','rebuild-race-fixture','school','986392');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','member','active');
INSERT INTO plugin_data.csf_terms (id,organization_id,code,label,school_year,semester,lifecycle_status,is_current)
VALUES ('cf400000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','F33','Fall 2033','2033-2034','fall','open',true);
INSERT INTO plugin_data.csf_roles (id,organization_id,key,display_name,role_type,is_system)
VALUES ('cf500000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','rebuild-race-officer','Rebuild officer','custom',false);
INSERT INTO plugin_data.csf_role_permissions (organization_id,role_id,permission_key,enabled)
VALUES ('cf100000-0000-4000-8000-000000000001','cf500000-0000-4000-8000-000000000001',plugin_data.csf_import_source_permission('class_history'),true);
INSERT INTO plugin_data.csf_staff_positions (id,organization_id,user_id,role_id,school_year,display_title,status)
VALUES ('cf600000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','cf500000-0000-4000-8000-000000000001','2033-2034','Rebuild officer','active');
INSERT INTO plugin_data.csf_cohorts (id,organization_id,graduation_year,label)
VALUES ('cf200000-0000-4000-8000-000000000001','cf100000-0000-4000-8000-000000000001',2034,'Class of 2034');
SELECT plugin_data.csf_queue_class_workbook_preparation(
'cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001',
'synthetic-race-workbook','cf000000-0000-4000-8000-000000000001','501','2026-09-01T00:00:00Z','[]');

UPDATE plugin_data.csf_class_workbooks SET last_prepared_version='501' WHERE organization_id='cf100000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status='completed' WHERE organization_id='cf100000-0000-4000-8000-000000000001';

SELECT extensions.dblink_connect('rebuild_permission_race','hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key('cf100000-0000-4000-8000-000000000001'));
SELECT extensions.dblink_send_query('rebuild_permission_race',$query$ SELECT plugin_data.csf_request_class_workbook_reprepare('cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001','synthetic-race-workbook')::text $query$);
DO $wait$
DECLARE
  waiting boolean;
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
  lock_key bigint := plugin_data.csf_staff_access_lock_key('cf100000-0000-4000-8000-000000000001');
BEGIN
  LOOP
    SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
      WHERE pid <> pg_backend_pid() AND locktype='advisory' AND NOT granted
      AND classid::bigint=((lock_key >> 32) & 4294967295)
      AND objid::bigint=(lock_key & 4294967295) AND objsubid=1) INTO waiting;
    EXIT WHEN waiting OR clock_timestamp() >= deadline;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF NOT waiting THEN RAISE EXCEPTION 'Rebuild did not wait for authority lock'; END IF;
END $wait$;
UPDATE plugin_data.csf_role_permissions SET enabled=false WHERE organization_id='cf100000-0000-4000-8000-000000000001';
COMMIT;
SELECT * FROM extensions.dblink_get_result('rebuild_permission_race',false) AS result(payload text);
SELECT extensions.ok(position('This officer does not hold the ' IN extensions.dblink_error_message('rebuild_permission_race')) > 0,'rebuild_permission_race refuses the waiting request after revocation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND action='sheets.class_workbook_reprepare_requested'),0,'rebuild_permission_race creates no additional receipt');
SELECT extensions.is((SELECT last_prepared_version FROM plugin_data.csf_class_workbooks WHERE organization_id='cf100000-0000-4000-8000-000000000001'),'501','rebuild_permission_race retains prepared state');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cf100000-0000-4000-8000-000000000001'),'completed','rebuild_permission_race does not restart the worker');
SELECT extensions.dblink_disconnect('rebuild_permission_race');
UPDATE plugin_data.csf_role_permissions SET enabled=true WHERE organization_id='cf100000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_request_class_workbook_reprepare('cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000002','synthetic-race-workbook') ->> 'status','queued','authorized rebuild creates the receipt used for replay');
UPDATE plugin_data.csf_class_workbooks SET last_prepared_version='501' WHERE organization_id='cf100000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_class_workbook_refresh_jobs SET status='completed' WHERE organization_id='cf100000-0000-4000-8000-000000000001';

SELECT extensions.dblink_connect('rebuild_replay_race','hostaddr='||host(inet_server_addr())||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key('cf100000-0000-4000-8000-000000000001'));
SELECT extensions.dblink_send_query('rebuild_replay_race',$query$ SELECT plugin_data.csf_request_class_workbook_reprepare('cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000002','synthetic-race-workbook')::text $query$);
DO $wait$
DECLARE
  waiting boolean;
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
  lock_key bigint := plugin_data.csf_staff_access_lock_key('cf100000-0000-4000-8000-000000000001');
BEGIN
  LOOP
    SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
      WHERE pid <> pg_backend_pid() AND locktype='advisory' AND NOT granted
      AND classid::bigint=((lock_key >> 32) & 4294967295)
      AND objid::bigint=(lock_key & 4294967295) AND objsubid=1) INTO waiting;
    EXIT WHEN waiting OR clock_timestamp() >= deadline;
    PERFORM pg_sleep(0.01);
  END LOOP;
  IF NOT waiting THEN RAISE EXCEPTION 'Rebuild did not wait for authority lock'; END IF;
END $wait$;
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cf100000-0000-4000-8000-000000000001';
COMMIT;
SELECT * FROM extensions.dblink_get_result('rebuild_replay_race',false) AS result(payload text);
SELECT extensions.ok(position('This officer is not an active member' IN extensions.dblink_error_message('rebuild_replay_race')) > 0,'rebuild_replay_race refuses the waiting request after revocation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cf100000-0000-4000-8000-000000000001' AND action='sheets.class_workbook_reprepare_requested'),1,'rebuild_replay_race creates no additional receipt');
SELECT extensions.is((SELECT last_prepared_version FROM plugin_data.csf_class_workbooks WHERE organization_id='cf100000-0000-4000-8000-000000000001'),'501','rebuild_replay_race retains prepared state');
SELECT extensions.is((SELECT status FROM plugin_data.csf_class_workbook_refresh_jobs WHERE organization_id='cf100000-0000-4000-8000-000000000001'),'completed','rebuild_replay_race does not restart the worker');
SELECT extensions.dblink_disconnect('rebuild_replay_race');
SELECT * FROM extensions.finish();
