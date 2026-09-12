BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email) VALUES
  ('a9c90000-0000-4000-8000-000000000001','retry-officer@local.test'),
  ('a9c90000-0000-4000-8000-000000000099','retry-outsider@local.test');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('a9c90000-0000-4000-8000-000000000002','Application retry fixture','application-range-fixture','school','990029');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES ('a9c90000-0000-4000-8000-000000000005','a9c90000-0000-4000-8000-000000000002',2040,'Class of 2040');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('a9c90000-0000-4000-8000-000000000006','a9c90000-0000-4000-8000-000000000002','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000005','a9c90000-0000-4000-8000-000000000006');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('a9c90000-0000-4000-8000-000000000007','a9c90000-0000-4000-8000-000000000002','Fictional','Retry','fictional','retry');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
VALUES ('a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000007','a9c90000-0000-4000-8000-000000000005','active');
INSERT INTO plugin_data.csf_sheet_sources
  (id,organization_id,title,provider,spreadsheet_id,source_type,drive_file_id,drive_access_state,settings)
VALUES ('a9c90000-0000-4000-8000-000000000003','a9c90000-0000-4000-8000-000000000002',
  'Fictional retry Sheet','google_sheets','fictional-retry-sheet','application_responses',
  'fictional-retry-sheet','accessible','{"mappingVersion":1}');
CREATE TEMP TABLE retry_payload AS SELECT jsonb_build_object(
  'sheet_tab_name','Responses','row_number',2,'import_status','ambiguous',
  'cohort_id','a9c90000-0000-4000-8000-000000000005','term_id','a9c90000-0000-4000-8000-000000000006',
  'normalized_data',jsonb_build_object('contractVersion','csf-normalized-import/v1','sourceType','application_responses',
    'record',jsonb_build_object('identity',jsonb_build_object('firstName','Fictional','lastName','Retry',
      'normalizedFirstName','fictional','normalizedLastName','retry'),
      'cohort',jsonb_build_object('gradeLevel',12),
      'submission',jsonb_build_object('submittedAt','2039-09-01T00:00:00Z')))) AS value;

CREATE TEMP TABLE range_mapping AS SELECT jsonb_build_object('version',1,'sourceType','application_responses',
  'sourceFileId','fictional-retry-sheet','sourceProvider','google_sheets','headerSignature',repeat('d',64),
  'columns',jsonb_build_object('firstName','column:4','lastName','column:3','gradeLevel','column:6'),
  'tabs',jsonb_build_array(jsonb_build_object('tabName','Responses','range','Responses!A1:W20',
    'headerRow',1,'termCode','F39','cohortYear',NULL,'targetStrategy','derive_from_grade'))) AS value;
INSERT INTO plugin_data.csf_sheet_import_jobs
(id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
SELECT 'a9c90000-0000-4000-8000-000000000004','a9c90000-0000-4000-8000-000000000002',
'a9c90000-0000-4000-8000-000000000003','a9c90000-0000-4000-8000-000000000001',
'preview','completed','application_responses','fictional-retry-sheet',1,value FROM range_mapping;
-- A valid historical settlement supplies the immutable succeeded origin under test.
INSERT INTO plugin_data.csf_sheet_import_rows
(id,organization_id,source_id,job_id,cohort_id,term_id,sheet_tab_name,row_number,row_hash,normalized_data,
 import_status,matched_profile_id,commit_target_profile_id,commit_outcome_state,commit_outcome_resolution,
 commit_outcome_resolved_by,commit_outcome_resolved_at,resolution_status,resolved_by,resolved_at)
SELECT 'a9c90000-0000-4000-8000-000000000009','a9c90000-0000-4000-8000-000000000002',
'a9c90000-0000-4000-8000-000000000003','a9c90000-0000-4000-8000-000000000004',
'a9c90000-0000-4000-8000-000000000005','a9c90000-0000-4000-8000-000000000006','Responses',2,repeat('a',64),
value->'normalized_data','created','a9c90000-0000-4000-8000-000000000007',
'a9c90000-0000-4000-8000-000000000007','succeeded','historical_accepted',
'a9c90000-0000-4000-8000-000000000001',now(),'resolved',
'a9c90000-0000-4000-8000-000000000001',now() FROM retry_payload;
UPDATE plugin_data.csf_sheet_sources SET settings='{"mappingVersion":2}'
WHERE id='a9c90000-0000-4000-8000-000000000003';
CREATE TEMP TABLE expansion_cases AS
SELECT name,md5('csf-range-retry-'||name)::uuid id,
  CASE name
  WHEN 'unqualified' THEN jsonb_set(value,'{tabs,0,range}','"A1:W30"')
  WHEN 'lowercase' THEN jsonb_set(value,'{tabs,0,range}','"Responses!a1:w30"')
  WHEN 'eight-digit-row' THEN jsonb_set(value,'{tabs,0,range}','"A1:W10000000"')
  WHEN 'wrong-qualifier' THEN jsonb_set(value,'{tabs,0,range}','"Other!A1:W30"')
  WHEN 'out-of-bounds' THEN jsonb_set(value,'{tabs,0,range}','"A1:W10000001"')
  WHEN 'reversed-columns' THEN jsonb_set(value,'{tabs,0,range}','"W1:A30"')
  WHEN 'changed-column' THEN jsonb_set(value,'{columns,firstName}','"column:5"')
  WHEN 'changed-header' THEN jsonb_set(value,'{headerSignature}',to_jsonb(repeat('e',64)))
  WHEN 'changed-term' THEN jsonb_set(value,'{tabs,0,termCode}','"S40"')
  WHEN 'changed-strategy' THEN jsonb_set(value,'{tabs,0,targetStrategy}','"fixed"')
  WHEN 'changed-start' THEN jsonb_set(value,'{tabs,0,range}','"Responses!A2:W30"')
  WHEN 'changed-width' THEN jsonb_set(value,'{tabs,0,range}','"Responses!A1:X30"')
  WHEN 'shrunk-range' THEN jsonb_set(value,'{tabs,0,range}','"Responses!A1:W10"')
  WHEN 'malformed-range' THEN jsonb_set(value,'{tabs,0,range}','"Responses!A1:W99999999999999999999"')
  ELSE jsonb_set(value,'{tabs,0,range}','"Responses!A1:W30"') END || '{"version":2}'::jsonb mapping,
  CASE WHEN name='changed-identity' THEN jsonb_set((SELECT value FROM retry_payload),
    '{normalized_data,record,identity,normalizedFirstName}','"different"')
  ELSE (SELECT value FROM retry_payload) END ||
    '{"retry_of_row_id":"a9c90000-0000-4000-8000-000000000009"}'::jsonb payload
FROM range_mapping CROSS JOIN (VALUES('expanded-range'),('unqualified'),('lowercase'),('eight-digit-row'),('wrong-qualifier'),('out-of-bounds'),('reversed-columns'),('changed-column'),('changed-header'),
('changed-term'),('changed-strategy'),('changed-start'),('changed-width'),('shrunk-range'),
('malformed-range'),('changed-identity')) cases(name);
INSERT INTO plugin_data.csf_sheet_import_jobs
(id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot)
SELECT 'a9c90000-0000-4000-8000-000000000018','a9c90000-0000-4000-8000-000000000002',
'a9c90000-0000-4000-8000-000000000003','a9c90000-0000-4000-8000-000000000001',
'preview','running','application_responses','fictional-retry-sheet',1,value FROM range_mapping;
SELECT plugin_data.csf_append_import_preview_rows('a9c90000-0000-4000-8000-000000000002',
'a9c90000-0000-4000-8000-000000000001','a9c90000-0000-4000-8000-000000000018',
(SELECT jsonb_build_array(value || '{"row_number":3}'::jsonb) FROM retry_payload));
UPDATE plugin_data.csf_sheet_import_jobs SET status='needs_resolution' WHERE id='a9c90000-0000-4000-8000-000000000018';
SELECT plugin_data.csf_reconcile_sheet_import_row('a9c90000-0000-4000-8000-000000000002',
(SELECT id FROM plugin_data.csf_sheet_import_rows WHERE job_id='a9c90000-0000-4000-8000-000000000018'),
'a9c90000-0000-4000-8000-000000000007','match','Fictional staff identity verification.',
'a9c90000-0000-4000-8000-000000000001',NULL);
INSERT INTO expansion_cases SELECT 'pending-mapping-change',md5('csf-range-retry-pending-mapping-change')::uuid,mapping,
payload || jsonb_build_object('row_number',3,'retry_of_row_id',
(SELECT id FROM plugin_data.csf_sheet_import_rows WHERE job_id='a9c90000-0000-4000-8000-000000000018'))
FROM expansion_cases WHERE name='expanded-range';
INSERT INTO plugin_data.csf_sheet_import_jobs
(id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,mapping_snapshot,retry_of_job_id)
SELECT id,'a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000003',
'a9c90000-0000-4000-8000-000000000001','preview','running','application_responses','fictional-retry-sheet',2,mapping,
CASE WHEN name='pending-mapping-change' THEN 'a9c90000-0000-4000-8000-000000000018'::uuid
ELSE 'a9c90000-0000-4000-8000-000000000004'::uuid END FROM expansion_cases;
SELECT lives_ok(format($q$SELECT plugin_data.csf_append_import_preview_rows(
'a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000001',%L::uuid,jsonb_build_array(%L::jsonb))$q$,id,payload),
name||' starts unbound through the append boundary') FROM expansion_cases;
UPDATE plugin_data.csf_sheet_import_jobs SET status='needs_resolution' WHERE id IN(SELECT id FROM expansion_cases);
SELECT is(plugin_data.csf_recover_application_retry_matches(
'a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000001',id)->>'restored',
CASE WHEN name IN('expanded-range','unqualified','lowercase','eight-digit-row') THEN '1' ELSE '0' END,name||' obeys committed mapping evidence') FROM expansion_cases;
SELECT is(plugin_data.csf_recover_application_retry_matches(
'a9c90000-0000-4000-8000-000000000002','a9c90000-0000-4000-8000-000000000001',
(SELECT id FROM expansion_cases WHERE name='expanded-range'))->>'restored','0','repeating successful recovery is idempotent');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id='a9c90000-0000-4000-8000-000000000002'
AND action='sheets.row_match_resolved'),5,'only proven canonical expansions record new audited matches');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='a9c90000-0000-4000-8000-000000000002'),0,
'recovering a binding does not create or approve an application');
SELECT ok(NOT has_function_privilege('authenticated','plugin_data.csf_recover_application_retry_matches(uuid,uuid,uuid,uuid)','EXECUTE'),
'authenticated members cannot recover import bindings');
SELECT * FROM finish();
ROLLBACK;
