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
  '[{"tabName":"Responses","termCode":"F39","targetStrategy":"derive_from_grade","rangeA1":"A1:Q4","headerRow":1}]',
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
    'tabs',jsonb_build_array(jsonb_build_object('tabName','Responses','range','Responses!A1:Q4','headerRow',1)),
    'automaticUpdateAuthorizationId',value->>'authorizationId','automaticUpdateGeneration',1,
    'automaticUpdateProviderVersion','4','automaticUpdateReadScope','mapped_columns_all_rows','headerSignature',repeat('d',64)),
  repeat('a',64),repeat('b',64),3,'csf-normalized-import/v1'
FROM safe_scope_lease;
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,matched_profile_id,row_hash,normalized_data)
SELECT fixture.id,'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
  'cfc50000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001',
  'Responses',fixture.row_number,fixture.status,CASE WHEN fixture.status='pending' THEN 'cfc40000-0000-4000-8000-000000000001'::uuid END,
  repeat('c',64),CASE WHEN fixture.row_number=2 THEN '{"sourceType":"application_responses","targetStatus":"resolved","rejected":false,"record":{"identity":{"firstName":"Avery","lastName":"Newapplicant"},"contact":{"responseEmail":"new-applicant@local.test"},"cohort":{"gradeLevel":12},"submission":{"submittedAt":"2039-09-01T00:00:00Z"}},"commitPayload":{"version":"csf-commit-payload/v1","sourceType":"application_responses","identity":{"firstName":"Avery","lastName":"Newapplicant","normalizedFirstName":"avery","normalizedLastName":"newapplicant"},"canonicalEmails":{"schoolEmail":null,"personalEmail":null},"applicationData":{"currentGradeLevel":12}}}'::jsonb ELSE '{"commitPayload":{"firstName":"Fictional","lastName":"Member"}}'::jsonb END
FROM (VALUES ('cfc80000-0000-4000-8000-000000000001'::uuid,2,'ambiguous'),
  ('cfc80000-0000-4000-8000-000000000002'::uuid,3,'ambiguous'),
  ('cfc80000-0000-4000-8000-000000000003'::uuid,4,'conflict')) fixture(id,row_number,status);
SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfc10000-0000-4000-8000-000000000001',
  (value->>'authorizationId')::uuid,1,(value->>'leaseToken')::uuid,'prepared','4','cfc60000-0000-4000-8000-000000000002') FROM safe_scope_lease;


SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid)','EXECUTE'),'members cannot create automatic applicant profiles');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_automatic_application_new_profile_is_safe(uuid,uuid)','EXECUTE'),'internal identity probe is not a runtime API');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_import_preview_evidence_blockers(uuid,uuid,boolean)','EXECUTE'),'runtime cannot bypass ordinary row-readiness checks');
UPDATE plugin_data.csf_sheet_sources SET drive_trashed=true WHERE id='cfc50000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')$test$,'55000','Application source evidence or write outcomes need review before creating profiles.','an inaccessible source cannot create a profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'source refusal creates no applicant');
UPDATE plugin_data.csf_sheet_sources SET drive_trashed=false WHERE id='cfc50000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_profiles SET first_name='Avery',last_name='Newapplicant',normalized_first_name='avery',normalized_last_name='newapplicant' WHERE id='cfc40000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_automatic_application_new_profile_is_safe('cfc10000-0000-4000-8000-000000000001','cfc80000-0000-4000-8000-000000000001'),'an existing name requires review instead of a duplicate profile');
UPDATE plugin_data.csf_profiles SET first_name='Fictional',last_name='Member',normalized_first_name='fictional',normalized_last_name='member',school_email='new-applicant@local.test',normalized_school_email='new-applicant@local.test' WHERE id='cfc40000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_automatic_application_new_profile_is_safe('cfc10000-0000-4000-8000-000000000001','cfc80000-0000-4000-8000-000000000001'),'contact evidence belonging to another profile requires review');
UPDATE plugin_data.csf_profiles SET school_email=NULL,normalized_school_email=NULL WHERE id='cfc40000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,row_hash,normalized_data)
SELECT 'cfc80000-0000-4000-8000-000000000004',organization_id,'cfc60000-0000-4000-8000-000000000001',source_id,cohort_id,term_id,sheet_tab_name,5,
  import_status,row_hash,jsonb_set(normalized_data,'{commitPayload,identity,normalizedFirstName}','"different"')
FROM plugin_data.csf_sheet_import_rows WHERE id='cfc80000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_automatic_application_new_profile_is_safe('cfc10000-0000-4000-8000-000000000001','cfc80000-0000-4000-8000-000000000004'),'inconsistent normalized names cannot create a profile that the commit would reject');
DELETE FROM plugin_data.csf_cohort_terms WHERE organization_id='cfc10000-0000-4000-8000-000000000001';
SELECT extensions.ok(NOT plugin_data.csf_automatic_application_new_profile_is_safe('cfc10000-0000-4000-8000-000000000001','cfc80000-0000-4000-8000-000000000001'),'a class without the source semester configured requires review before profile creation');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('cfc10000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000001')$test$,'55000','Prepare this application Sheet under its automatic-update authorization first.','manual previews cannot use source-authorized creation');
SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','1','one safe new applicant is created under saved source consent');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),2,'one existing and one new profile remain');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND reported_application_personal_email='new-applicant@local.test' AND personal_email IS NULL AND normalized_personal_email IS NULL),1,'the response email is reported separately from identity');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'creating an applicant does not import or approve an application');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'creating a profile does not approve semester membership');
SELECT extensions.is((SELECT resolution_metadata->>'matchMethod' FROM plugin_data.csf_sheet_import_rows WHERE id='cfc80000-0000-4000-8000-000000000001'),'source_authorized_new_profile','source authorization is recorded as the connection basis');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='sheets.automatic_application_profile_created'),1,'one creation receipt records the authorizing officer');
SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','0','lost-response retry creates no second profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND job_id='cfc60000-0000-4000-8000-000000000002' AND import_status IN ('ambiguous','conflict')),2,'uncertain siblings remain in review');
SELECT extensions.is(plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'queued','1','the new applicant can enter the existing safe-row commit queue');
SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','0','a frozen approval cannot gain newly created targets');
SELECT plugin_data.csf_set_sheet_automatic_update_authorization('cfc10000-0000-4000-8000-000000000001','cfc50000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001',1,'pause','cfc70000-0000-4000-8000-000000000002',NULL);
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')$test$,'55000','Automatic updates changed. Review this Sheet before importing.','Pause refuses further profile creation');
SELECT * FROM extensions.finish();
ROLLBACK;
