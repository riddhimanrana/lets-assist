BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cfa00000-0000-4000-8000-000000000001','authenticated','authenticated','link-officer@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cfa10000-0000-4000-8000-000000000001','Workbook link fixture','workbook-link-fixture','school','975381');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cfa10000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts (id,organization_id,graduation_year,label)
VALUES ('cfa20000-0000-4000-8000-000000000001','cfa10000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_profiles (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('cfa30000-0000-4000-8000-000000000001','cfa10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner');
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id,profile_id,cohort_id,status)
VALUES ('cfa10000-0000-4000-8000-000000000001','cfa30000-0000-4000-8000-000000000001','cfa20000-0000-4000-8000-000000000001','active');
INSERT INTO plugin_data.csf_class_workbooks (organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,state)
VALUES ('cfa10000-0000-4000-8000-000000000001','cfa20000-0000-4000-8000-000000000001','fictional-link-workbook','cfa00000-0000-4000-8000-000000000001','1','linked');
INSERT INTO plugin_data.csf_sheet_sources (id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id)
VALUES ('cfa40000-0000-4000-8000-000000000001','cfa10000-0000-4000-8000-000000000001','cfa20000-0000-4000-8000-000000000001','class_history','Fixture workbook','google_sheets','fictional-link-workbook');
INSERT INTO plugin_data.csf_sheet_import_jobs (id,organization_id,source_id,mode,status,source_type,source_file_id)
SELECT ('cfa50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cfa10000-0000-4000-8000-000000000001','cfa40000-0000-4000-8000-000000000001','preview','needs_resolution','class_history',CASE WHEN n=4 THEN 'other-workbook' ELSE 'fictional-link-workbook' END
FROM generate_series(1,4) n;
INSERT INTO plugin_data.csf_sheet_import_rows (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,matched_profile_id,import_status)
SELECT ('cfa60000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfa10000-0000-4000-8000-000000000001',('cfa50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfa40000-0000-4000-8000-000000000001','cfa20000-0000-4000-8000-000000000001','F39',2,
  '{"record":{"identity":{"firstName":"Fixture","lastName":"Learner","normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"LearnerFixture"}}}'::jsonb,
  CASE WHEN n=1 THEN 'cfa30000-0000-4000-8000-000000000001'::uuid ELSE NULL END,
  CASE WHEN n=1 THEN 'created' ELSE 'ambiguous' END
FROM generate_series(1,4) n;

SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_reviewed_workbook_profile_links','SELECT'),'browser cannot read identity links');
SELECT extensions.ok(NOT has_table_privilege('service_role','plugin_data.csf_reviewed_workbook_profile_links','INSERT'),'server cannot bypass the audited link function');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE'),'anonymous confirmation refused');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_revoke_workbook_profile_link(uuid,uuid,uuid,text)','EXECUTE'),'browser revocation refused');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),NULL::uuid,'a name-derived key alone remains blocked');
CREATE TEMP TABLE workbook_link_receipts (value jsonb);
INSERT INTO workbook_link_receipts VALUES (plugin_data.csf_confirm_workbook_profile_link('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000002','cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.'));
SELECT extensions.is((SELECT value->>'status' FROM workbook_link_receipts),'linked','officer saves a reviewed link');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),'cfa30000-0000-4000-8000-000000000001'::uuid,'later semester reuses the explicitly reviewed profile');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000004'),NULL::uuid,'another workbook cannot use the link');
SELECT extensions.is((SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='cfa60000-0000-4000-8000-000000000002'),'pending','reviewed row is matched but not committed');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfa10000-0000-4000-8000-000000000001'),1,'linking creates no extra profile');
INSERT INTO plugin_data.csf_sheet_import_rows (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,import_status)
SELECT 'cfa60000-0000-4000-8000-000000000005',organization_id,job_id,source_id,cohort_id,sheet_tab_name,3,
  jsonb_set(normalized_data,'{record,contact}','{"schoolEmail":"different@local.test"}'),'ambiguous'
FROM plugin_data.csf_sheet_import_rows WHERE id='cfa60000-0000-4000-8000-000000000003';
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000005'),NULL::uuid,'saved links never override conflicting contact evidence');
INSERT INTO plugin_data.csf_sheet_import_rows (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,import_status)
SELECT 'cfa60000-0000-4000-8000-000000000006',organization_id,job_id,source_id,cohort_id,sheet_tab_name,4,
  '{"record":{"identity":{"normalizedFirstName":"fixturel","normalizedLastName":"earner","sourceStudentKey":"fixturelearner"}}}','ambiguous'
FROM plugin_data.csf_sheet_import_rows WHERE id='cfa60000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000006')$test$,'23514','This workbook key has conflicting immutable student names. Resolve the source rows before importing another semester.','a colliding name key still requires review');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000099','cfa60000-0000-4000-8000-000000000003'),NULL::uuid,'another organization cannot use the link');
UPDATE plugin_data.csf_class_workbooks SET state='blocked' WHERE organization_id='cfa10000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),NULL::uuid,'a blocked workbook stops saved match reuse');
UPDATE plugin_data.csf_class_workbooks SET state='linked' WHERE organization_id='cfa10000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_profile_cohort_memberships SET status='archived' WHERE organization_id='cfa10000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),NULL::uuid,'a removed class membership stops saved match reuse');
UPDATE plugin_data.csf_profile_cohort_memberships SET status='active' WHERE organization_id='cfa10000-0000-4000-8000-000000000001';
SELECT extensions.is(plugin_data.csf_confirm_workbook_profile_link('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000002','cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.')->>'replayed','true','lost response replays its receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfa10000-0000-4000-8000-000000000001' AND action='sheets.workbook_profile_link_confirmed'),1,'retry does not duplicate audit receipts');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_confirm_workbook_profile_link('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003','cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.')$test$,'22023','This request belongs to a different profile decision.','request intent cannot change');
SELECT extensions.is(plugin_data.csf_revoke_workbook_profile_link('cfa10000-0000-4000-8000-000000000001',(SELECT (value->>'linkId')::uuid FROM workbook_link_receipts),'cfa00000-0000-4000-8000-000000000001','Officer removed this link.')->>'status','revoked','officer can revoke a saved link');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),NULL::uuid,'revocation returns later rows to review');
SELECT extensions.is(plugin_data.csf_confirm_workbook_profile_link('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000002','cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.')->>'status','revoked','old confirmation retry never reactivates a revoked link');
UPDATE public.organization_members SET status='inactive' WHERE organization_id='cfa10000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_confirm_workbook_profile_link('cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000002','cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001','cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.')$test$,'42501','This officer is not an active member of the organization whose CSF import they are acting on.','revoked officer cannot replay a link request');
SELECT * FROM extensions.finish();
ROLLBACK;
