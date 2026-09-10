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
  '[{"tabName":"Responses","termCode":"F39","targetStrategy":"derive_from_grade","rangeA1":"A1:Q54","headerRow":1}]',
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
    'tabs',jsonb_build_array(jsonb_build_object('tabName','Responses','range','Responses!A1:Q54','headerRow',1)),
    'automaticUpdateAuthorizationId',value->>'authorizationId','automaticUpdateGeneration',1,
    'automaticUpdateProviderVersion','4','automaticUpdateReadScope','mapped_columns_all_rows','headerSignature',repeat('d',64)),
  repeat('a',64),repeat('b',64),53,'csf-normalized-import/v1'
FROM safe_scope_lease;
INSERT INTO plugin_data.csf_sheet_import_rows
 (id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,row_hash,normalized_data)
SELECT md5('synthetic-applicant-row:'||n::text)::uuid,'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
 'cfc50000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001',
 'Responses',n,'ambiguous',encode(sha256(convert_to(n::text,'UTF8')),'hex'),
 CASE WHEN n<=52 THEN jsonb_build_object('sourceType','application_responses','targetStatus','resolved','rejected',false,
 'record',jsonb_build_object('identity',jsonb_build_object('firstName','Synthetic '||n::text,'lastName','Applicant'),
   'contact',jsonb_build_object('responseEmail','synthetic'||n::text||'@local.test')),
 'commitPayload',jsonb_build_object('version','csf-commit-payload/v1','sourceType','application_responses',
   'identity',jsonb_build_object('firstName','Synthetic '||n::text,'lastName','Applicant','normalizedFirstName','synthetic '||n::text,'normalizedLastName','applicant'),'canonicalEmails','{}'::jsonb,
   'applicationData',jsonb_build_object('currentGradeLevel',12)))
 ELSE '{}'::jsonb END
FROM generate_series(2,54) AS n;
SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfc10000-0000-4000-8000-000000000001',
  (value->>'authorizationId')::uuid,1,(value->>'leaseToken')::uuid,'prepared','4','cfc60000-0000-4000-8000-000000000002') FROM safe_scope_lease;



CREATE TEMP TABLE first_profile_batch AS SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002') AS receipt;
SELECT extensions.is((SELECT receipt->>'created' FROM first_profile_batch),'50','one call creates no more than fifty applicants');
SELECT extensions.is((SELECT receipt->>'remaining' FROM first_profile_batch),'true','remaining work is explicit');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),51,'first batch adds fifty profiles beside the original member');
CREATE TEMP TABLE final_profile_batch AS SELECT plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002') AS receipt;
SELECT extensions.is((SELECT receipt->>'created' FROM final_profile_batch),'1','the next batch continues with only the remaining applicant');
SELECT extensions.is((SELECT receipt->>'remaining' FROM final_profile_batch),'false','no safe new applicant remains');
SELECT extensions.is(plugin_data.csf_prepare_automatic_application_profiles('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'created','0','a repeated batch does not repeat any profile creation');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='sheets.automatic_application_profile_created'),51,'every created applicant has one source-authorized receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND (school_email IS NOT NULL OR personal_email IS NOT NULL)),51,'all new applicants retain contact addresses without account verification');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'profile preparation makes no application decisions');
SELECT extensions.ok((SELECT next_check_at>=now()+interval '4 minutes' FROM plugin_data.csf_sheet_automatic_update_authorizations WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),'finished preparation restores the metadata check interval');
SELECT extensions.is(plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'readyRows','51','all prepared applicants enter the safe-row approval together');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_automatic_import_approval_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),51,'uncertain siblings do not enter the frozen approval');
SELECT * FROM extensions.finish();
ROLLBACK;
