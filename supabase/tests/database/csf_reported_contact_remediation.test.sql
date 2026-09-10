BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users(id,email) VALUES ('cfc00000-0000-4000-8000-000000000001','safe-import-officer@local.test');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('cfc10000-0000-4000-8000-000000000001','Safe import fixture','safe-import-fixture','school','957832');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('cfc10000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES ('cfc20000-0000-4000-8000-000000000001','cfc10000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('cfc30000-0000-4000-8000-000000000001','cfc10000-0000-4000-8000-000000000001','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('cfc10000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('cfc40000-0000-4000-8000-000000000001','cfc10000-0000-4000-8000-000000000001','Fictional','Member','fictional','member');
INSERT INTO plugin_data.csf_sheet_sources
  (id,organization_id,source_type,title,provider,spreadsheet_id,target_strategy,tab_mappings,settings,sync_owner_user_id,
    drive_access_state,drive_file_id,drive_mime_type,drive_modified_at)
VALUES ('cfc50000-0000-4000-8000-000000000001','cfc10000-0000-4000-8000-000000000001','application_responses',
  'Fictional application responses','google_sheets','fictional-safe-source','derive_from_grade',
  '[{"tabName":"Responses","termCode":"F39","targetStrategy":"derive_from_grade","rangeA1":"A1:Q10","headerRow":1}]',
  '{"mappingVersion":1,"sourceKind":"application_responses","evidenceRevision":"4"}',
  'cfc00000-0000-4000-8000-000000000001','accessible','fictional-safe-source','application/vnd.google-apps.spreadsheet','2039-09-01T00:00:00Z');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
VALUES ('cfc60000-0000-4000-8000-000000000001','cfc10000-0000-4000-8000-000000000001',
  'cfc50000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001','preview','completed',
  'application_responses','fictional-safe-source',1,jsonb_build_object('headerSignature',repeat('d',64)));

INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,personal_email,normalized_personal_email)
SELECT ('cfd40000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfc10000-0000-4000-8000-000000000001','Reported','Fixture'||n,'reported','fixture'||n,
  'reported'||n||'@local.test','reported'||n||'@local.test'
FROM generate_series(1,8) n;
UPDATE plugin_data.csf_profiles SET school_email='reported-school@local.test',normalized_school_email='reported-school@local.test' WHERE id='cfd40000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,matched_profile_id,row_hash,normalized_data)
SELECT ('cfd80000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000001',
  'cfc50000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001',
  'Responses',n+1,'pending',('cfd40000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('c',64),
  jsonb_build_object('sourceType','application_responses','record',jsonb_build_object('contact',jsonb_build_object('responseEmail','reported'||n||'@local.test')))
FROM generate_series(1,8) n;
INSERT INTO plugin_data.csf_admin_audit_events(id,organization_id,actor_user_id,action,target_type,target_id,before_data,after_data,created_at)
SELECT ('cfd90000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfc10000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001',
  'profile.application_contacts_captured','csf_profiles',('cfd40000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('schoolEmail',null,'personalEmail',CASE WHEN n=4 THEN 'prior@local.test' END),
  jsonb_build_object('schoolEmail',CASE WHEN n=1 THEN 'reported-school@local.test' END,'personalEmail','reported'||n||'@local.test',
    'importRowId',('cfd80000-0000-4000-8000-'||lpad(n::text,12,'0')),'accountLinked',false),now()-interval '1 hour'
FROM generate_series(1,8) n WHERE n<>5;
UPDATE plugin_data.csf_profiles SET personal_email='staff-new@local.test',normalized_personal_email='staff-new@local.test'
  WHERE id='cfd40000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id)
VALUES('cfc10000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001','profile.edit','csf_profiles','cfd40000-0000-4000-8000-000000000003');
INSERT INTO plugin_data.csf_profile_accounts(organization_id,profile_id,user_id,status)
VALUES('cfc10000-0000-4000-8000-000000000001','cfd40000-0000-4000-8000-000000000006','cfc00000-0000-4000-8000-000000000001','verified');
UPDATE plugin_data.csf_profiles SET reported_application_personal_email='other-reported@local.test'
  WHERE id='cfd40000-0000-4000-8000-000000000007';
UPDATE plugin_data.csf_profiles SET normalized_personal_email='different-normalized@local.test'
  WHERE id='cfd40000-0000-4000-8000-000000000008';
SELECT extensions.is(plugin_data.csf_reclassify_captured_application_contacts('cfc10000-0000-4000-8000-000000000001'),1,'only the unchanged blank-origin helper contact is moved');
SELECT extensions.ok((SELECT personal_email IS NULL AND normalized_personal_email IS NULL AND reported_application_personal_email='reported1@local.test' AND school_email IS NULL AND normalized_school_email IS NULL AND reported_application_school_email='reported-school@local.test'
  FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000001'),'reported address is retained outside canonical identity');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000002'),'staff-new@local.test','different staff value is preserved');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000003'),'reported3@local.test','later staff audit preserves even an equal current value');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000004'),'reported4@local.test','nonblank origin is preserved');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000005'),'reported5@local.test','unaudited contact is preserved');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000006'),'reported6@local.test','account history excludes automatic remediation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE profile_id='cfd40000-0000-4000-8000-000000000006' AND status='verified'),1,'account link is unchanged');
SELECT extensions.is((SELECT reported_application_personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000007'),'other-reported@local.test','a different reported contact is preserved');
SELECT extensions.is((SELECT normalized_personal_email FROM plugin_data.csf_profiles WHERE id='cfd40000-0000-4000-8000-000000000008'),'different-normalized@local.test','normalized identity drift is preserved for staff review');
SELECT extensions.is(plugin_data.csf_reclassify_captured_application_contacts('cfc10000-0000-4000-8000-000000000001'),0,'remediation replay is a no-op');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action='profile.application_contacts_reclassified' AND organization_id='cfc10000-0000-4000-8000-000000000001'),1,'one durable remediation audit exists');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_reclassify_captured_application_contacts(uuid)','EXECUTE'),'remediation is internal only');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_reclassify_captured_application_contacts(uuid)','EXECUTE'),'members cannot invoke remediation');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid)','EXECUTE'),'anonymous callers cannot capture reported contacts');
SELECT extensions.ok(NOT has_column_privilege('authenticated','plugin_data.csf_profiles','reported_application_personal_email','SELECT'),'reported contact is not exposed to authenticated browser queries');
SELECT * FROM extensions.finish();
ROLLBACK;
