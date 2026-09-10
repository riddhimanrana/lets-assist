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



SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002');
UPDATE plugin_data.csf_profiles SET reported_application_personal_email=NULL WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Newapplicant';
SELECT plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002');
CREATE TEMP TABLE automatic_claim AS SELECT plugin_data.csf_claim_import_commit_attempt('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002','cfc00000-0000-4000-8000-000000000001',300,
 (plugin_data.csf_refresh_sheet_source_evidence('cfc10000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001','cfc50000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
 (SELECT evidence_generation FROM plugin_data.csf_sheet_sources WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND id='cfc50000-0000-4000-8000-000000000001'),
 'fictional-safe-source','application/vnd.google-apps.spreadsheet','2039-09-01T00:00:00Z','4',false,'accessible','Fictional applications')->>'evidenceToken')::uuid) AS receipt;
CREATE TEMP TABLE automatic_batch AS SELECT plugin_data.csf_commit_import_row_batch('cfc10000-0000-4000-8000-000000000001',
 (SELECT (receipt->>'attemptId')::uuid FROM automatic_claim),'cfc90000-0000-4000-8000-000000000001',ARRAY['cfc80000-0000-4000-8000-000000000001'::uuid]) AS receipt;
SELECT extensions.is((SELECT reported_application_personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Newapplicant'),'new-applicant@local.test','application commit fills the existing resolved profile blank contact');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'the queued applicant becomes one imported application');
SELECT extensions.is((SELECT commit_outcome_state FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND id='cfc80000-0000-4000-8000-000000000001'),'succeeded','the application row has a confirmed success receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND decision_status='approved'),0,'importing does not approve the application');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'importing does not approve semester membership');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),2,'the commit reuses the prepared applicant rather than creating another profile');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND import_status IN ('ambiguous','conflict')),2,'uncertain siblings remain untouched by the commit');
CREATE TEMP TABLE captured_contacts AS SELECT count(*) AS total FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='profile.reported_application_contacts_captured';
UPDATE plugin_data.csf_profiles SET personal_email='officer-updated@local.test',normalized_personal_email='officer-updated@local.test' WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Newapplicant';
SELECT plugin_data.csf_commit_import_row_batch('cfc10000-0000-4000-8000-000000000001',(SELECT (receipt->>'attemptId')::uuid FROM automatic_claim),
 'cfc90000-0000-4000-8000-000000000001',ARRAY['cfc80000-0000-4000-8000-000000000001'::uuid]);
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'replaying a lost batch response creates no duplicate application');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batches WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'the retry retains one batch receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batch_outcomes WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'the retry retains one row outcome');
SELECT extensions.is((SELECT personal_email FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND last_name='Newapplicant'),'officer-updated@local.test','a replay preserves the later officer contact correction');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='profile.reported_application_contacts_captured'),(SELECT total FROM captured_contacts),'commit replay adds no duplicate contact audit');
CREATE TEMP TABLE automatic_finalization AS SELECT plugin_data.csf_finalize_import_commit_attempt(
 'cfc10000-0000-4000-8000-000000000001',(SELECT (receipt->>'attemptId')::uuid FROM automatic_claim),'{}'::jsonb) AS receipt;
SELECT extensions.is((SELECT receipt->>'committed' FROM automatic_finalization),'1','finalization retains the successful application beside review exceptions');
SELECT extensions.is((SELECT receipt->>'status' FROM automatic_finalization),'partially_completed','uncertain siblings remain visible instead of reporting the entire Sheet complete');
SELECT extensions.is((SELECT receipt->>'unknownOutcomes' FROM automatic_finalization),'0','finalization confirms that the saved application has no unknown write outcome');
SELECT * FROM extensions.finish();
ROLLBACK;
