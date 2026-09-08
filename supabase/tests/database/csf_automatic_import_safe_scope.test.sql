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
  repeat('c',64),'{"commitPayload":{"firstName":"Fictional","lastName":"Member"}}'
FROM (VALUES ('cfc80000-0000-4000-8000-000000000001'::uuid,2,'pending'),
  ('cfc80000-0000-4000-8000-000000000002'::uuid,3,'ambiguous'),
  ('cfc80000-0000-4000-8000-000000000003'::uuid,4,'conflict')) fixture(id,row_number,status);
SELECT plugin_data.csf_finish_sheet_automatic_update_check('cfc10000-0000-4000-8000-000000000001',
  (value->>'authorizationId')::uuid,1,(value->>'leaseToken')::uuid,'prepared','4','cfc60000-0000-4000-8000-000000000002') FROM safe_scope_lease;

SELECT extensions.ok(NOT has_table_privilege('service_role','plugin_data.csf_automatic_import_approvals','INSERT'),'runtime cannot manufacture automatic approvals');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_automatic_import_approval_rows','SELECT'),'selected rows remain server-only');
SELECT extensions.ok(NOT plugin_data.csf_automatic_import_scope_current('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002'),'a prepared preview is not automatically approved');
SELECT extensions.is(cardinality(plugin_data.csf_import_preview_claim_blockers('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')),1,'ordinary claim still sees unresolved siblings');
SELECT extensions.is(plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'queued','1','authorized ready row queues despite two uncertain siblings');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_automatic_import_approval_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'approval freezes only the ready row');
SELECT extensions.is(cardinality(plugin_data.csf_import_preview_claim_blockers('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')),0,'valid scoped claim keeps all source checks but allows unresolved siblings');
SELECT extensions.is(plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')->>'replayed','true','queue retry replays the original batch receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_import_commit_queue WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),1,'retry creates no duplicate queue item');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND action='sheets.automatic_safe_rows_approved'),1,'automatic approval records one officer-attributed audit');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_import_rows WHERE organization_id='cfc10000-0000-4000-8000-000000000001' AND import_status IN ('ambiguous','conflict') AND commit_frozen_at IS NULL),2,'uncertain rows remain untouched');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='cfc10000-0000-4000-8000-000000000001'),0,'queueing neither imports nor approves applications');
UPDATE plugin_data.csf_sheet_import_rows SET import_status='pending' WHERE id='cfc80000-0000-4000-8000-000000000002';
SELECT extensions.ok(NOT plugin_data.csf_automatic_import_scope_current('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002'),'newly resolved rows do not silently enter an old approval');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_queue_automatic_import_preview('cfc10000-0000-4000-8000-000000000001','cfc60000-0000-4000-8000-000000000002')$test$,'55000','The approved rows changed. Prepare this Sheet again.','changed selected rows cannot reuse a batch receipt');
SELECT * FROM extensions.finish();
ROLLBACK;
