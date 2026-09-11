-- Separate sessions prove that queued Sheet actions observe permission revocation.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(10);
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES('f7000000-0000-4000-8000-000000000001','authenticated','authenticated','sheet-race@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES('f7100000-0000-4000-8000-000000000001','Sheet permission race','sheet-permission-race','school','985271');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','member','active');
INSERT INTO plugin_data.csf_roles(id,organization_id,key,display_name,role_type,is_system) VALUES('f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','sheet-race-reviewer','Sheet reviewer','custom',false);
INSERT INTO plugin_data.csf_role_permissions(organization_id,role_id,permission_key,enabled)
SELECT 'f7100000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001',permission,true FROM unnest(ARRAY['manage_sheet_sync','export_sensitive_reports','decide_applications','view_applications','verify_submissions']) permission;
INSERT INTO plugin_data.csf_staff_positions(id,organization_id,user_id,role_id,school_year,display_title,status) VALUES('f7300000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','2051-2052','Sheet reviewer','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester,is_current) VALUES('f7400000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','F51','Fall 2051','2051-2052','fall',true);
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES('f7500000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','Race','Student','race','student');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES('f7550000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001',2054,'Class of 2054');
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES('f7600000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7500000-0000-4000-8000-000000000001','f7550000-0000-4000-8000-000000000001','f7400000-0000-4000-8000-000000000001','manual','submitted');
INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,term_id,is_test,configured_by,enabled,privacy_verified_at,comment_capability) VALUES('f7700000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','fictional-sheet-race',0,'applications','f7400000-0000-4000-8000-000000000001',false,'f7000000-0000-4000-8000-000000000001',true,now(),'available');
INSERT INTO plugin_data.csf_sheet_sync_bindings(id,organization_id,destination_id,record_kind,record_id,logical_key,sheet_id) VALUES('f7800000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7700000-0000-4000-8000-000000000001','application','f7600000-0000-4000-8000-000000000001','application:race',0);
INSERT INTO plugin_data.csf_sheet_sync_changes(id,organization_id,destination_id,record_kind,record_id,source_version,remote_version,payload) VALUES('f7900000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','f7700000-0000-4000-8000-000000000001','application','f7600000-0000-4000-8000-000000000001','fixture-version','remote-version','{"action":"approved"}');
CREATE TEMP TABLE sheet_race_waits(key text PRIMARY KEY,observed boolean);

SELECT extensions.ok(plugin_data.csf_actor_has_permission('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','manage_sheet_sync'),'reviewer starts with sync authority');
SELECT extensions.dblink_connect('sheet_review_race','hostaddr='||coalesce(host(inet_server_addr()),'127.0.0.1')||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
BEGIN;
SELECT pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key('f7100000-0000-4000-8000-000000000001'));
SELECT extensions.dblink_send_query('sheet_review_race',$query$SELECT plugin_data.csf_review_sheet_sync_change('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7900000-0000-4000-8000-000000000001',false,'Discard after review.')::text$query$);
DO $wait$
DECLARE waiting boolean:=false; deadline timestamptz:=clock_timestamp()+interval '15 seconds'; lock_key bigint:=plugin_data.csf_staff_access_lock_key('f7100000-0000-4000-8000-000000000001');
BEGIN
 LOOP
  SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid<>pg_backend_pid() AND locktype='advisory' AND NOT granted AND classid::bigint=((lock_key>>32)&4294967295) AND objid::bigint=(lock_key&4294967295) AND objsubid=1) INTO waiting;
  EXIT WHEN waiting OR clock_timestamp()>=deadline;
  PERFORM pg_sleep(0.01);
 END LOOP;
 INSERT INTO sheet_race_waits VALUES('review',waiting);
END $wait$;
SELECT extensions.ok((SELECT observed FROM sheet_race_waits WHERE key='review'),'review waits on the staff authority lock before mutation');
UPDATE plugin_data.csf_role_permissions SET enabled=false WHERE organization_id='f7100000-0000-4000-8000-000000000001' AND role_id='f7200000-0000-4000-8000-000000000001' AND permission_key='manage_sheet_sync';
COMMIT;
SELECT * FROM extensions.dblink_get_result('sheet_review_race',false) AS result(payload text);
SELECT extensions.ok(position('Not authorized' IN extensions.dblink_error_message('sheet_review_race'))>0,'queued review observes the revoked manage_sheet_sync permission');
SELECT extensions.is((SELECT status FROM plugin_data.csf_sheet_sync_changes WHERE id='f7900000-0000-4000-8000-000000000001'),'pending','revoked review leaves the change pending');
SELECT extensions.is((SELECT status::text FROM plugin_data.csf_term_applications WHERE id='f7600000-0000-4000-8000-000000000001'),'submitted','revoked review leaves the application unchanged');
SELECT extensions.dblink_disconnect('sheet_review_race');
UPDATE plugin_data.csf_role_permissions SET enabled=true WHERE organization_id='f7100000-0000-4000-8000-000000000001' AND role_id='f7200000-0000-4000-8000-000000000001' AND permission_key='manage_sheet_sync';

SELECT extensions.ok(plugin_data.csf_actor_has_permission('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','view_applications'),'message author starts with application access');
SELECT extensions.dblink_connect('sheet_message_race','hostaddr='||coalesce(host(inet_server_addr()),'127.0.0.1')||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
BEGIN;
SELECT pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key('f7100000-0000-4000-8000-000000000001'));
SELECT extensions.dblink_send_query('sheet_message_race',$query$SELECT plugin_data.csf_add_sheet_sync_local_message('f7100000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7800000-0000-4000-8000-000000000001','f7a00000-0000-4000-8000-000000000001',NULL,'Queued application discussion.',NULL)::text$query$);
DO $wait$
DECLARE waiting boolean:=false; deadline timestamptz:=clock_timestamp()+interval '15 seconds'; lock_key bigint:=plugin_data.csf_staff_access_lock_key('f7100000-0000-4000-8000-000000000001');
BEGIN
 LOOP
  SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid<>pg_backend_pid() AND locktype='advisory' AND NOT granted AND classid::bigint=((lock_key>>32)&4294967295) AND objid::bigint=(lock_key&4294967295) AND objsubid=1) INTO waiting;
  EXIT WHEN waiting OR clock_timestamp()>=deadline;
  PERFORM pg_sleep(0.01);
 END LOOP;
 INSERT INTO sheet_race_waits VALUES('message',waiting);
END $wait$;
SELECT extensions.ok((SELECT observed FROM sheet_race_waits WHERE key='message'),'message waits on the staff authority lock before mutation');
UPDATE plugin_data.csf_role_permissions SET enabled=false WHERE organization_id='f7100000-0000-4000-8000-000000000001' AND role_id='f7200000-0000-4000-8000-000000000001' AND permission_key='view_applications';
COMMIT;
SELECT * FROM extensions.dblink_get_result('sheet_message_race',false) AS result(payload text);
SELECT extensions.ok(position('Not authorized' IN extensions.dblink_error_message('sheet_message_race'))>0,'queued message observes the revoked view_applications permission');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_sheet_sync_local_messages WHERE organization_id='f7100000-0000-4000-8000-000000000001'),0::bigint,'revoked application reader writes no message');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE organization_id='f7100000-0000-4000-8000-000000000001' AND action='sheet_sync.message_added'),0::bigint,'revoked application reader writes no message receipt');
SELECT extensions.dblink_disconnect('sheet_message_race');
UPDATE plugin_data.csf_role_permissions SET enabled=true WHERE organization_id='f7100000-0000-4000-8000-000000000001' AND role_id='f7200000-0000-4000-8000-000000000001' AND permission_key='view_applications';

DELETE FROM plugin_data.csf_sheet_sync_changes WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_sheet_sync_local_messages WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_sheet_writeback_ledger WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_sheet_sync_bindings WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_sheet_sync_destinations WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members WHERE organization_id='f7100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations WHERE id='f7100000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id='f7000000-0000-4000-8000-000000000001';
SELECT * FROM extensions.finish();
