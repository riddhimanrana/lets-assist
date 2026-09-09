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
  '[{"tabName":"Responses","termCode":"F39","targetStrategy":"derive_from_grade","rangeA1":"A1:Q1003","headerRow":1}]',
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
    'tabs',jsonb_build_array(jsonb_build_object('tabName','Responses','range','Responses!A1:Q1003','headerRow',1)),
    'automaticUpdateAuthorizationId',value->>'authorizationId','automaticUpdateGeneration',1,
    'automaticUpdateProviderVersion','4','automaticUpdateReadScope','mapped_columns_all_rows','headerSignature',repeat('d',64)),
  repeat('a',64),repeat('b',64),1002,'csf-normalized-import/v1'
FROM safe_scope_lease;
INSERT INTO plugin_data.csf_sheet_import_rows
 (id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,import_status,row_hash,normalized_data)
SELECT md5('synthetic-applicant-row:'||n::text)::uuid,'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
 'cfc50000-0000-4000-8000-000000000001','cfc20000-0000-4000-8000-000000000001','cfc30000-0000-4000-8000-000000000001',
 'Responses',n,'ambiguous',encode(sha256(convert_to(n::text,'UTF8')),'hex'),
 CASE WHEN n<=1001 THEN jsonb_build_object('sourceType','application_responses','targetStatus','resolved','rejected',false,
 'record',jsonb_build_object('identity',jsonb_build_object('firstName','Synthetic '||n::text,'lastName','Applicant'),
   'contact',jsonb_build_object('responseEmail','synthetic'||n::text||'@local.test')),
 'commitPayload',jsonb_build_object('version','csf-commit-payload/v1','sourceType','application_responses',
   'identity',jsonb_build_object('firstName','Synthetic '||n::text,'lastName','Applicant','normalizedFirstName','synthetic '||n::text,'normalizedLastName','applicant'),'canonicalEmails','{}'::jsonb,
   'applicationData',jsonb_build_object('currentGradeLevel',12)))
 ELSE '{}'::jsonb END
FROM generate_series(2,1003) AS n;
SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfc10000-0000-4000-8000-000000000001',
  (value->>'authorizationId')::uuid,1,(value->>'leaseToken')::uuid,'prepared','4','cfc60000-0000-4000-8000-000000000002') FROM safe_scope_lease;




CREATE TEMP TABLE automatic_scale_timing(started_at timestamptz, prepared_at timestamptz, finished_at timestamptz);
INSERT INTO automatic_scale_timing(started_at) VALUES (clock_timestamp());
DO $$
BEGIN
  FOR batch_number IN 1..20 LOOP
    PERFORM plugin_data.csf_prepare_automatic_application_profiles(
      'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002');
  END LOOP;
END $$;
UPDATE automatic_scale_timing SET prepared_at=clock_timestamp();
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_profiles
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1001,
 'one thousand safe applicants receive one profile each');
SELECT extensions.is(plugin_data.csf_queue_automatic_import_preview(
 'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'readyRows',
 '1000','the approval freezes one thousand safe rows without uncertain siblings');
CREATE TEMP TABLE automatic_scale_claim AS
SELECT plugin_data.csf_claim_import_commit_attempt(
 'cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
 'cfc00000-0000-4000-8000-000000000001',600,
 (plugin_data.csf_refresh_sheet_source_evidence(
   'cfc10000-0000-4000-8000-000000000001','cfc00000-0000-4000-8000-000000000001',
   'cfc50000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002',
   (SELECT evidence_generation FROM plugin_data.csf_sheet_sources
     WHERE id='cfc50000-0000-4000-8000-000000000001'),
   'fictional-safe-source','application/vnd.google-apps.spreadsheet',
   '2039-09-01T00:00:00Z','4',false,'accessible','Fictional applications')->>'evidenceToken')::uuid
) AS receipt;
DO $$
DECLARE
  row_ids uuid[];
  request_id uuid;
  attempt_id uuid := (SELECT (receipt->>'attemptId')::uuid FROM automatic_scale_claim);
BEGIN
  FOR batch_number IN 0..19 LOOP
    SELECT array_agg(md5('synthetic-applicant-row:'||n::text)::uuid ORDER BY n)
      INTO row_ids FROM generate_series(2+batch_number*50,51+batch_number*50) AS n;
    request_id := md5('synthetic-application-scale-batch:'||batch_number::text)::uuid;
    PERFORM plugin_data.csf_commit_import_row_batch(
      'cfc10000-0000-4000-8000-000000000001',attempt_id,request_id,row_ids);
    PERFORM plugin_data.csf_commit_import_row_batch(
      'cfc10000-0000-4000-8000-000000000001',attempt_id,request_id,row_ids);
  END LOOP;
END $$;
UPDATE automatic_scale_timing SET finished_at=clock_timestamp();
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1000,
 'batch response retries create exactly one thousand applications');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND commit_outcome_state='succeeded'),1000,
 'every safe row has a successful commit receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batches
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),20,'retries preserve twenty batch receipts');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_row_batch_outcomes
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1000,
 'retries preserve one outcome per source row');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND decision_status='approved'),0,
 'importing one thousand applications approves none of them');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_memberships
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,
 'application imports do not manufacture semester memberships');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND import_status='ambiguous'),2,
 'uncertain source rows remain available for officer review');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows
 WHERE organization_id='cfc10000-0000-4000-8000-000000000001'
 AND commit_outcome_state IN ('unknown','historical_unknown','in_flight')),0,
 'the successful import leaves no unresolved write outcomes');
SELECT extensions.ok((SELECT finished_at-started_at < interval '10 minutes' FROM automatic_scale_timing),
 'one thousand profiles and applications including batch replay finish within ten minutes');
SELECT extensions.diag('Application import database elapsed seconds: '||
 (SELECT round(extract(epoch FROM finished_at-started_at)::numeric,3)::text FROM automatic_scale_timing));
SELECT extensions.diag('Applicant preparation database elapsed seconds: '||
 (SELECT round(extract(epoch FROM prepared_at-started_at)::numeric,3)::text FROM automatic_scale_timing));
SELECT extensions.diag('Application commits and replay database elapsed seconds: '||
 (SELECT round(extract(epoch FROM finished_at-prepared_at)::numeric,3)::text FROM automatic_scale_timing));
SELECT * FROM extensions.finish();
ROLLBACK;
