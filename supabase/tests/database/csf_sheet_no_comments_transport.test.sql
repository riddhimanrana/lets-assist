BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(17);

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

INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,term_id,is_test,configured_by,managed_headers) VALUES
('fa300000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fictional-no-comments',0,'applications','fa200000-0000-4000-8000-000000000001',false,'fa000000-0000-4000-8000-000000000001','["Record ID","Source version","Requested decision","Requested points"]');

SELECT extensions.is((SELECT discussion_transport FROM plugin_data.csf_sheet_sync_destinations WHERE id='fa300000-0000-4000-8000-000000000001'),'native','legacy SQL callers retain the native default');
SELECT extensions.lives_ok($$SELECT plugin_data.csf_configure_sheet_discussion_transport('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','none')$$,'the application can select none on a new unused destination');
SELECT extensions.is(plugin_data.csf_sheet_discussion_configuration('fa300000-0000-4000-8000-000000000001'),'{"discussion_transport":"none"}'::jsonb,'none is part of acceptance identity');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations SET managed_headers='["Record ID","Comments","Source version"]' WHERE id='fa300000-0000-4000-8000-000000000001'$$,'23514',NULL,'none rejects a managed Comments column');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_configure_sheet_discussion_transport('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','column')$$,'P0001','The discussion mode does not match the managed Comments columns.','column mode requires a managed Comments column');
SELECT extensions.lives_ok($$SELECT plugin_data.csf_configure_sheet_discussion_transport('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','native')$$,'unused destination can opt into native mode');
SELECT extensions.is(plugin_data.csf_sheet_discussion_configuration('fa300000-0000-4000-8000-000000000001'),'{}'::jsonb,'legacy native acceptance identity stays unchanged');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_configure_sheet_discussion_transport('fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','other')$$,'P0001','The discussion mode does not match the managed Comments columns.','unknown modes fail closed');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text)','EXECUTE'),'browser cannot configure discussion mode');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text)','EXECUTE'),'service role configures discussion mode');
SELECT extensions.ok(position('ELSIF d.discussion_transport=''column'' THEN' in pg_get_functiondef('plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)'::regprocedure))>0,'acceptance isolates column comment evidence from none');
SELECT extensions.ok(position('Repeated sync needs distinct retained export versions.' in pg_get_functiondef('plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)'::regprocedure))>0 AND position('Approval, rejection and correction need reviewed application and point receipts.' in pg_get_functiondef('plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)'::regprocedure))>0,'none acceptance retains version and decision receipts');
SELECT extensions.ok(position('snapshot-ARRAY[''comments'',''local_messages'']' in pg_get_functiondef('plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)'::regprocedure))>0,'none versions omit app and Sheet discussion history');
SELECT extensions.ok(position($needle$TG_TABLE_NAME<>'csf_review_notes' OR discussion_transport<>'none'$needle$ in pg_get_functiondef('plugin_data.csf_queue_changed_sheet_sync_record()'::regprocedure))>0,'private notes do not queue no-comments destinations');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid)','EXECUTE'),'the delegated full snapshot stays owner-only');

INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,term_id,is_test,configured_by,managed_headers,discussion_transport) VALUES
('fa300000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000000001','fictional-none-version',0,'applications','fa200000-0000-4000-8000-000000000001',false,'fa000000-0000-4000-8000-000000000001','["Record ID","Source version","Requested decision","Requested points"]','none');
INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,logical_key,sheet_id) VALUES
('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000003','application','fa230000-0000-4000-8000-000000000001','none-fixture',0);
CREATE TEMP TABLE no_comment_versions AS SELECT md5(plugin_data.csf_sheet_sync_destination_snapshot('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000003','application','fa230000-0000-4000-8000-000000000001')::text) before_note;
INSERT INTO plugin_data.csf_review_notes(organization_id,period_id,subject_kind,subject_id,body,author_user_id) VALUES
('fa100000-0000-4000-8000-000000000001','fa240000-0000-4000-8000-000000000001','application','fa230000-0000-4000-8000-000000000001','Private note retained only in the app','fa000000-0000-4000-8000-000000000001');
SELECT extensions.is(md5(plugin_data.csf_sheet_sync_destination_snapshot('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000003','application','fa230000-0000-4000-8000-000000000001')::text),(SELECT before_note FROM no_comment_versions),'none source version stays stable across a private note');

INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,term_id,is_test,configured_by,managed_headers,discussion_transport) VALUES
('fa300000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000001','fictional-native-comments',0,'applications','fa200000-0000-4000-8000-000000000001',false,'fa000000-0000-4000-8000-000000000001','["Record ID","Source version","Requested decision","Requested points"]','native');
INSERT INTO plugin_data.csf_sheet_sync_bindings(organization_id,destination_id,record_kind,record_id,logical_key,sheet_id) VALUES
('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002','application','fa230000-0000-4000-8000-000000000001','native-fixture',0);
CREATE TEMP TABLE native_versions AS SELECT md5(plugin_data.csf_sheet_sync_destination_snapshot('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002','application','fa230000-0000-4000-8000-000000000001')::text) before_note;
INSERT INTO plugin_data.csf_review_notes(organization_id,period_id,subject_kind,subject_id,body,author_user_id) VALUES
('fa100000-0000-4000-8000-000000000001','fa240000-0000-4000-8000-000000000001','application','fa230000-0000-4000-8000-000000000001','Second private note for native version','fa000000-0000-4000-8000-000000000001');
SELECT extensions.isnt(md5(plugin_data.csf_sheet_sync_destination_snapshot('fa100000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002','application','fa230000-0000-4000-8000-000000000001')::text),(SELECT before_note FROM native_versions),'native source version retains discussion changes');

SELECT * FROM extensions.finish();
ROLLBACK;
