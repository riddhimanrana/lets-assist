BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email) VALUES
  ('a9b90000-0000-4000-8000-000000000001','retry-officer@local.test'),
  ('a9b90000-0000-4000-8000-000000000099','retry-outsider@local.test');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('a9b90000-0000-4000-8000-000000000002','Application retry fixture','application-retry-fixture','school','990019');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES ('a9b90000-0000-4000-8000-000000000005','a9b90000-0000-4000-8000-000000000002',2040,'Class of 2040');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('a9b90000-0000-4000-8000-000000000006','a9b90000-0000-4000-8000-000000000002','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000005','a9b90000-0000-4000-8000-000000000006');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('a9b90000-0000-4000-8000-000000000007','a9b90000-0000-4000-8000-000000000002','Fictional','Retry','fictional','retry');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
VALUES ('a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000007','a9b90000-0000-4000-8000-000000000005','active');
INSERT INTO plugin_data.csf_sheet_sources
  (id,organization_id,title,provider,spreadsheet_id,source_type,drive_file_id,drive_access_state,settings)
VALUES ('a9b90000-0000-4000-8000-000000000003','a9b90000-0000-4000-8000-000000000002',
  'Fictional retry Sheet','google_sheets','fictional-retry-sheet','application_responses',
  'fictional-retry-sheet','accessible','{"mappingVersion":1}');
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,retry_of_job_id)
VALUES
  ('a9b90000-0000-4000-8000-000000000004','a9b90000-0000-4000-8000-000000000002',
   'a9b90000-0000-4000-8000-000000000003','a9b90000-0000-4000-8000-000000000001',
   'preview','running','application_responses','fictional-retry-sheet',1,NULL),
  ('a9b90000-0000-4000-8000-000000000008','a9b90000-0000-4000-8000-000000000002',
   'a9b90000-0000-4000-8000-000000000003','a9b90000-0000-4000-8000-000000000001',
   'preview','running','application_responses','fictional-retry-sheet',1,'a9b90000-0000-4000-8000-000000000004');
CREATE TEMP TABLE retry_payload AS SELECT jsonb_build_object(
  'sheet_tab_name','Responses','row_number',2,'import_status','ambiguous',
  'cohort_id','a9b90000-0000-4000-8000-000000000005','term_id','a9b90000-0000-4000-8000-000000000006',
  'normalized_data',jsonb_build_object('contractVersion','csf-normalized-import/v1','sourceType','application_responses',
    'record',jsonb_build_object('identity',jsonb_build_object('firstName','Fictional','lastName','Retry',
      'normalizedFirstName','fictional','normalizedLastName','retry'),
      'cohort',jsonb_build_object('gradeLevel',12),
      'submission',jsonb_build_object('submittedAt','2039-09-01T00:00:00Z')))) AS value;
SELECT lives_ok($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000004',(SELECT jsonb_build_array(value) FROM retry_payload))$sql$,
  'parent application is persisted through the actual append boundary');
UPDATE plugin_data.csf_sheet_import_jobs SET status='needs_resolution'
  WHERE id='a9b90000-0000-4000-8000-000000000004';
SELECT lives_ok($sql$SELECT plugin_data.csf_reconcile_sheet_import_row(
  'a9b90000-0000-4000-8000-000000000002',
  (SELECT id FROM plugin_data.csf_sheet_import_rows WHERE job_id='a9b90000-0000-4000-8000-000000000004'),
  'a9b90000-0000-4000-8000-000000000007','match','Fictional officer reviewed this source identity.',
  'a9b90000-0000-4000-8000-000000000001',NULL)$sql$,
  'the officer decision creates an audited parent match without an application commit');
UPDATE retry_payload SET value=value || jsonb_build_object('retry_of_row_id',
  (SELECT id FROM plugin_data.csf_sheet_import_rows WHERE job_id='a9b90000-0000-4000-8000-000000000004'));
SELECT throws_ok($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000008',(SELECT jsonb_build_array(value ||
    '{"matched_profile_id":"a9b90000-0000-4000-8000-000000000007"}'::jsonb) FROM retry_payload))$sql$,
  '23514','A CSF application preview row may not arrive already bound to a member; an officer resolves it.',
  'a caller-selected target remains forbidden even with a real parent');
SELECT lives_ok($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000008',(SELECT jsonb_build_array(value) FROM retry_payload))$sql$,
  'retry rows arrive without a selected profile');
UPDATE plugin_data.csf_sheet_import_jobs SET status='needs_resolution'
  WHERE id='a9b90000-0000-4000-8000-000000000008';
SELECT is(plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000008')->>'restored','1',
  'the database restores the audited uncommitted application target');
SELECT is((SELECT matched_profile_id::text FROM plugin_data.csf_sheet_import_rows
  WHERE job_id='a9b90000-0000-4000-8000-000000000008'),'a9b90000-0000-4000-8000-000000000007',
  'the recovered target is the original profile');
SELECT is(plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000008')->>'restored','0','lost-response replay restores nothing twice');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_profiles WHERE organization_id='a9b90000-0000-4000-8000-000000000002'),1,
  'retry creates no duplicate profile');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='a9b90000-0000-4000-8000-000000000002'),0,
  'match recovery does not import or approve applications');
SELECT is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
  WHERE organization_id='a9b90000-0000-4000-8000-000000000002' AND action='sheets.row_match_resolved'),2,
  'original and recovered decisions retain separate audit events');
SELECT ok(NOT has_function_privilege('authenticated','plugin_data.csf_recover_application_retry_matches(uuid,uuid,uuid,uuid)','EXECUTE'),
  'members cannot invoke source-identity recovery');

CREATE TEMP TABLE retry_cases AS
SELECT name, md5('csf-application-retry-' || name)::uuid AS id, mapping_version,
  CASE WHEN name='changed-identity' THEN
    jsonb_set(jsonb_set(value,'{normalized_data,record,identity,firstName}','"Different"'),
      '{normalized_data,record,identity,normalizedFirstName}','"different"')
    WHEN name='unproven-superseded' THEN value || '{"import_status":"superseded"}'::jsonb
    ELSE value END AS payload
FROM retry_payload CROSS JOIN (VALUES
  ('changed-identity',1),('changed-mapping',2),('duplicate-candidate',1),('unproven-superseded',1)
) scenarios(name,mapping_version);
INSERT INTO plugin_data.csf_sheet_import_jobs
  (id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,mapping_version,retry_of_job_id)
SELECT id,'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000003',
  'a9b90000-0000-4000-8000-000000000001','preview','running','application_responses',
  'fictional-retry-sheet',mapping_version,'a9b90000-0000-4000-8000-000000000004'
FROM retry_cases;
SELECT lives_ok(format($sql$SELECT plugin_data.csf_append_import_preview_rows(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  %L::uuid,jsonb_build_array(%L::jsonb))$sql$,id,payload),
  name || ' enters immutable preview storage without a target') FROM retry_cases;
UPDATE plugin_data.csf_sheet_import_jobs SET status='needs_resolution'
  WHERE id IN (SELECT id FROM retry_cases);
SELECT is((SELECT import_status FROM plugin_data.csf_sheet_import_rows
  WHERE job_id=(SELECT id FROM retry_cases WHERE name='unproven-superseded')),
  'ambiguous','an unproven already-imported request becomes reviewable, not unbound pending');
SELECT is(plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  (SELECT id FROM retry_cases WHERE name='unproven-superseded'))->>'restored','1',
  'fallback recovery still requires the original officer match and source evidence');
SELECT is(plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  (SELECT id FROM retry_cases WHERE name='changed-identity'))->>'restored','0',
  'changed student identity remains unresolved');
SELECT throws_ok($sql$SELECT plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  (SELECT id FROM retry_cases WHERE name='changed-mapping'))$sql$,
  '55000','The application source or mapping changed. Prepare a current preview.',
  'mapping changes cannot borrow an older officer decision');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('a9b90000-0000-4000-8000-000000000017','a9b90000-0000-4000-8000-000000000002','Fictional','Retry','fictional','retry');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
VALUES ('a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000017','a9b90000-0000-4000-8000-000000000005','active');
SELECT is(plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000001',
  (SELECT id FROM retry_cases WHERE name='duplicate-candidate'))->>'restored','0',
  'a new duplicate candidate blocks inherited matching');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000099','admin','active');
SELECT throws_ok($sql$SELECT plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000002','a9b90000-0000-4000-8000-000000000099',
  'a9b90000-0000-4000-8000-000000000008')$sql$,
  '42501','Choose a sealed application preview started by this officer.',
  'another administrator cannot take over the preview construction receipt');
SELECT throws_ok($sql$SELECT plugin_data.csf_recover_application_retry_matches(
  'a9b90000-0000-4000-8000-000000000098','a9b90000-0000-4000-8000-000000000001',
  'a9b90000-0000-4000-8000-000000000008')$sql$,
  '42501','CSF import job was not found for this organization.',
  'cross-organization preview IDs cannot be recovered');
SELECT * FROM finish();
ROLLBACK;
