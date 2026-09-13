BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(23);

INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES
('fa000000-0000-4000-8000-000000000001','authenticated','authenticated','no-comments-admin@local.test','{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('fa100000-0000-4000-8000-000000000001','No comments fixtures','no-comments-fixtures','school','749991');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','F31','Fall 2031','2031-2032','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('fa210000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001',2034,'Class of 2034');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('fa220000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','Fictional','Student','fictional','student');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id) VALUES
('fa100000-0000-4000-8000-000000000001','fa220000-0000-4000-8000-000000000001','fa210000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_term_applications(id,organization_id,profile_id,cohort_id,term_id,source,status) VALUES
('fa230000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa220000-0000-4000-8000-000000000001','fa210000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','manual','submitted');
INSERT INTO plugin_data.csf_review_periods(id,organization_id,term_id,kind,title) VALUES
('fa240000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','membership_applications','Fictional review');


INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,term_id,is_test,configured_by,managed_headers,discussion_transport,enabled,privacy_verified_at,comment_capability) VALUES
('fa300000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fictional-discussion-guard',0,'applications','fa200000-0000-4000-8000-000000000001',true,'fa000000-0000-4000-8000-000000000001','["Record ID","Source version","Requested decision","Requested points"]','none',true,now(),'available');
INSERT INTO plugin_data.csf_sheet_sync_bindings(id,organization_id,destination_id,record_kind,record_id,logical_key,sheet_id,thread_bindings) VALUES
('fa400000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','application','fa230000-0000-4000-8000-000000000001','fictional-discussion',0,'{"prior":{"threadId":"fictional-thread","postId":"fictional-post","localVersion":"prior"}}');

CREATE FUNCTION pg_temp.message(p_id integer, p_thread text DEFAULT NULL, p_resolved boolean DEFAULT NULL, p_body text DEFAULT 'Fictional message') RETURNS jsonb LANGUAGE sql AS $$
 SELECT plugin_data.csf_add_sheet_sync_local_message('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001',('fa500000-0000-4000-8000-'||lpad(p_id::text,12,'0'))::uuid,p_thread,p_body,p_resolved)
$$;

SELECT extensions.throws_ok($$SELECT pg_temp.message(1)$$,'P0001','Sheet discussions are disabled for this destination.','none rejects a new message');
SELECT extensions.throws_ok($$SELECT pg_temp.message(2,'fictional-thread')$$,'P0001','Sheet discussions are disabled for this destination.','none rejects a reply to a retained thread');
SELECT extensions.throws_ok($$SELECT pg_temp.message(3,'fictional-thread',true)$$,'P0001','Sheet discussions are disabled for this destination.','none rejects resolution');
SELECT extensions.throws_ok($$SELECT pg_temp.message(4,'fictional-thread',false)$$,'P0001','Sheet discussions are disabled for this destination.','none rejects reopening');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_sync_local_messages WHERE binding_id='fa400000-0000-4000-8000-000000000001'),0,'rejected messages leave no durable local history');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='fa100000-0000-4000-8000-000000000001' AND action='sheet_sync.message_added'),0,'rejected messages leave no success audit');

UPDATE plugin_data.csf_sheet_sync_destinations SET discussion_transport='native' WHERE id='fa300000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok($$SELECT pg_temp.message(5)$$,'enabled native accepts a message');
SELECT extensions.lives_ok($$SELECT pg_temp.message(5)$$,'enabled native retries the same request idempotently');
SELECT extensions.throws_ok($$SELECT pg_temp.message(5,NULL,NULL,'Changed body')$$,'P0001','Message request conflicts with its previous use.','a changed message does not overwrite a prior request');
SELECT extensions.lives_ok($$SELECT pg_temp.message(6,'fictional-thread',true)$$,'enabled native accepts a thread resolution');
SELECT extensions.throws_ok($$SELECT pg_temp.message(7,'other-thread')$$,'P0001','Thread does not belong to this record.','thread ownership still rejects unrelated replies');

UPDATE plugin_data.csf_sheet_sync_destinations SET enabled=false WHERE id='fa300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.message(8)$$,'P0001','Sync destination is disabled.','disabled native rejects a new message');
SELECT extensions.throws_ok($$SELECT pg_temp.message(9,'fictional-thread',false)$$,'P0001','Sync destination is disabled.','disabled native rejects reopening');
SELECT extensions.throws_ok($$SELECT pg_temp.message(5)$$,'P0001','Sync destination is disabled.','a disabled destination rejects a formerly successful request');

UPDATE plugin_data.csf_sheet_sync_destinations SET enabled=true,discussion_transport='none' WHERE id='fa300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.message(5)$$,'P0001','Sheet discussions are disabled for this destination.','none rejects a formerly successful request before replay');
UPDATE plugin_data.csf_sheet_sync_destinations SET discussion_transport='column',managed_headers='["Record ID","Source version","Requested decision","Requested points","Comments"]' WHERE id='fa300000-0000-4000-8000-000000000001';
SELECT extensions.lives_ok($$SELECT pg_temp.message(10)$$,'enabled column mode still accepts local discussion');
UPDATE plugin_data.csf_sheet_sync_destinations SET enabled=false WHERE id='fa300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.message(11)$$,'P0001','Sync destination is disabled.','disabled column mode rejects local discussion');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_sync_local_messages WHERE binding_id='fa400000-0000-4000-8000-000000000001'),3,'only the three accepted requests exist');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='fa100000-0000-4000-8000-000000000001' AND action='sheet_sync.message_added'),3,'accepted requests create exactly one audit entry each');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE'),'service role retains execution');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE'),'anonymous execution stays denied');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE'),'browser execution stays denied');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC execution stays denied');
SELECT * FROM extensions.finish();
ROLLBACK;
