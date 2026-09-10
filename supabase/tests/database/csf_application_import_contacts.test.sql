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
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfc10000-0000-4000-8000-000000000001',
  'cfc50000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001',1,'enable',
  'cfc70000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000001');
CREATE TEMP TABLE safe_scope_lease AS SELECT plugin_data.csf_claim_sheet_automatic_update_check() AS value;
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,source_file_name,
    source_modified_at,source_file_metadata,mapping_version,mapping_snapshot,source_content_hash,snapshot_hash,
    snapshot_row_count,snapshot_contract_version)
SELECT 'cfc60000-0000-4000-8000-000000000002','cfc10000-0000-4000-8000-000000000001',
  'cfc50000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001','preview','needs_resolution',
  'application_responses','fictional-safe-source','Fictional applications','2039-09-01T00:00:00Z',
  '{"id":"fictional-safe-source","sourceProvider":"google_sheets","mimeType":"application/vnd.google-apps.spreadsheet","version":"4","modifiedTime":"2039-09-01T00:00:00Z","trashed":false,"accessState":"accessible"}',1,
  jsonb_build_object('version',1,'sourceType','application_responses','sourceProvider','google_sheets','sourceFileId','fictional-safe-source',
    'tabs',jsonb_build_array(jsonb_build_object('tabName','Responses','range','Responses!A1:Q10','headerRow',1)),
    'automaticUpdateAuthorizationId',value->>'authorizationId','automaticUpdateGeneration',1,
    'automaticUpdateProviderVersion','4','automaticUpdateReadScope','mapped_columns_all_rows','headerSignature',repeat('d',64)),
  repeat('a',64),repeat('b',64),9,'csf-normalized-import/v1'
FROM safe_scope_lease;
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,matched_profile_id,row_hash,normalized_data)
SELECT fixture.id,'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
  'cfc50000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001',
  'Responses',fixture.row_number,fixture.status,CASE WHEN fixture.status='pending' THEN 'cfc40000-0000-4000-8000-000000000001'::uuid END,
  repeat('c',64),CASE WHEN fixture.row_number=2 THEN '{"sourceType":"application_responses","targetStatus":"resolved","rejected":false,"record":{"identity":{"firstName":"Avery","lastName":"Newapplicant"},"contact":{"responseEmail":"new-applicant@local.test"},"cohort":{"gradeLevel":12},"submission":{"submittedAt":"2039-09-01T00:00:00Z"}},"commitPayload":{"version":"csf-commit-payload/v1","sourceType":"application_responses","identity":{"firstName":"Avery","lastName":"Newapplicant","normalizedFirstName":"avery","normalizedLastName":"newapplicant"},"canonicalEmails":{"schoolEmail":null,"personalEmail":null},"applicationData":{"currentGradeLevel":12}}}'::jsonb WHEN fixture.row_number>=5 THEN jsonb_build_object('sourceType','application_responses','targetStatus','resolved','rejected',false,
'record',jsonb_build_object('identity',jsonb_build_object('firstName','Contact','lastName','Fixture'||fixture.row_number),'contact',
CASE fixture.row_number
WHEN 5 THEN '{"responseEmail":" AGREE@local.test ","preferredContactEmail":"agree@local.test"}'::jsonb
WHEN 6 THEN '{"responseEmail":"response@local.test","preferredContactEmail":"preferred@local.test"}'::jsonb
WHEN 7 THEN '{"responseEmail":"  ","preferredContactEmail":""}'::jsonb
WHEN 8 THEN '{"responseEmail":"invalid","preferredContactEmail":"bad@@local.test"}'::jsonb
WHEN 9 THEN '{"schoolEmail":"school@students.local.test","responseEmail":"response-school@local.test","preferredContactEmail":"home@local.test"}'::jsonb
WHEN 10 THEN '{"preferredContactEmail":"rejected@local.test","preferredContactEmailState":"invalid","responseEmail":"fallback@local.test","responseEmailState":"valid"}'::jsonb END),
'commitPayload',jsonb_build_object('version','csf-commit-payload/v1','sourceType','application_responses','identity',jsonb_build_object('firstName','Contact','lastName','Fixture'||fixture.row_number,'normalizedFirstName','contact','normalizedLastName','fixture'||fixture.row_number), 'canonicalEmails',jsonb_build_object('schoolEmail',null,'personalEmail',null),'applicationData',jsonb_build_object('currentGradeLevel',12)))
ELSE '{"commitPayload":{"firstName":"Fictional","lastName":"Member"}}'::jsonb END
FROM (VALUES ('cfc80000-0000-4000-8000-000000000001'::uuid,2,'ambiguous'),
  ('cfc80000-0000-4000-8000-000000000002'::uuid,3,'ambiguous'),
  ('cfc80000-0000-4000-8000-000000000003'::uuid,4,'conflict'),('cfc80000-0000-4000-8000-000000000004'::uuid,5,'ambiguous'),('cfc80000-0000-4000-8000-000000000005'::uuid,6,'ambiguous'),('cfc80000-0000-4000-8000-000000000006'::uuid,7,'ambiguous'),('cfc80000-0000-4000-8000-000000000007'::uuid,8,'ambiguous'),('cfc80000-0000-4000-8000-000000000008'::uuid,9,'ambiguous'),('cfc80000-0000-4000-8000-000000000009'::uuid,10,'ambiguous')) fixture(id,row_number,status);
SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfc10000-0000-4000-8000-000000000001',
  (value->>'authorizationId')::uuid,1,(value->>'leaseToken')::uuid,'prepared','4','cfc60000-0000-4000-8000-000000000002') FROM safe_scope_lease;



SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','7','valid new identities are prepared even when optional contacts are absent or invalid');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture5'),'agree@local.test','agreeing contacts normalize into one personal address');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6'),'preferred@local.test','preferred contact takes precedence over a distinct response address');
SELECT extensions.is((SELECT normalized_data#>>'{record,contact,responseEmail}' FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND job_id='cfc60000-0000-4000-8000-000000000002' AND row_number=6),'response@local.test','distinct response remains immutable source evidence');
SELECT extensions.ok((SELECT school_email IS NULL FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6'),'response email is not mislabeled as school email');
SELECT extensions.ok((SELECT personal_email IS NULL AND school_email IS NULL FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture7'),'blank addresses stay absent');
SELECT extensions.ok((SELECT personal_email IS NULL AND school_email IS NULL FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture8'),'malformed addresses stay absent');
SELECT extensions.is((SELECT school_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture9'),'school@students.local.test','explicit school contact is retained');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture9'),'home@local.test','explicit school and preferred contacts remain separate');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture10'),'fallback@local.test','declared invalid preferred evidence falls back to valid response');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profile_accounts WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'contact capture creates no account links');
CREATE TEMP TABLE contact_audit_before AS SELECT count(*) AS total FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='profile.application_contacts_captured';
SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','0','replay creates no duplicate applicant');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='profile.application_contacts_captured'),(SELECT total FROM contact_audit_before),'replay adds no contact audit');
UPDATE plugin_data.csf_profiles SET personal_email='staff-corrected@local.test',normalized_personal_email='staff-corrected@local.test' WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6';
SELECT plugin_data.csf_fill_application_profile_contacts('cfc10000-0000-4000-8000-000000000001',id,matched_profile_id,'cfc00000-0000-4000-8000-000000000001') FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND job_id='cfc60000-0000-4000-8000-000000000002' AND row_number=6;
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6'),'staff-corrected@local.test','existing officer contact survives later capture');
UPDATE plugin_data.csf_profiles SET personal_email=NULL,normalized_personal_email=NULL WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6';
UPDATE plugin_data.csf_profiles SET personal_email='preferred@local.test',normalized_personal_email='preferred@local.test' WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND id='cfc40000-0000-4000-8000-000000000001';
SELECT plugin_data.csf_fill_application_profile_contacts('cfc10000-0000-4000-8000-000000000001',id,matched_profile_id,'cfc00000-0000-4000-8000-000000000001') FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND job_id='cfc60000-0000-4000-8000-000000000002' AND row_number=6;
SELECT extensions.ok((SELECT personal_email IS NULL FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Fixture6'),'contact owned by another profile is skipped');
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='profile.application_contacts_captured' AND after_data->'skippedConflictingFields' ? 'personalEmail'),'contact collision is audited');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_fill_application_profile_contacts(uuid,uuid,uuid,uuid)','EXECUTE'),'contact helper is internal only');
SELECT * FROM extensions.finish();
ROLLBACK;
