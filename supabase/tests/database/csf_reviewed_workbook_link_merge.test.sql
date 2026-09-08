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


CREATE TEMP TABLE saved_workbook_link AS
SELECT plugin_data.csf_confirm_workbook_profile_link(
'cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000002',
'cfa30000-0000-4000-8000-000000000001','cfa00000-0000-4000-8000-000000000001',
'cfa70000-0000-4000-8000-000000000001','Reviewed immutable workbook evidence.') AS receipt;
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
SELECT 'cfa30000-0000-4000-8000-000000000002',organization_id,first_name,last_name,normalized_first_name,normalized_last_name
FROM plugin_data.csf_profiles WHERE id='cfa30000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_reviewed_workbook_profile_links(
organization_id,cohort_id,source_file_id,source_key,profile_id,reviewed_row_id,authorized_by,request_id,reason,revoked_at,revoked_by,revocation_reason)
SELECT organization_id,cohort_id,source_file_id,'FixtureRevokedKey',profile_id,reviewed_row_id,authorized_by,
'cfa70000-0000-4000-8000-000000000002',reason,now(),authorized_by,'Fictional revoked decision.'
FROM plugin_data.csf_reviewed_workbook_profile_links WHERE revoked_at IS NULL;
CREATE TEMP TABLE before_workbook_links AS
SELECT id,to_jsonb(l) AS snapshot FROM plugin_data.csf_reviewed_workbook_profile_links l;

SELECT extensions.throws_ok($merge$
SELECT plugin_data.csf_merge_profiles(
'cfa10000-0000-4000-8000-000000000001','cfa30000-0000-4000-8000-000000000001',
'cfa30000-0000-4000-8000-000000000002','Officer reviewed the fictional records.',
'cfa00000-0000-4000-8000-000000000001','cfa80000-0000-4000-8000-000000000001')
$merge$,'P0001','These CSF student records have conflicts that must be resolved before merging.',
'a reviewed workbook link does not authorize a name-only profile merge');
SELECT extensions.ok(NOT EXISTS(
SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links l JOIN before_workbook_links b USING(id)
WHERE to_jsonb(l) IS DISTINCT FROM b.snapshot),'a refused merge changes no reviewed links');
UPDATE plugin_data.csf_profiles
SET school_email='fixture-learner@local.test',normalized_school_email='fixture-learner@local.test'
WHERE organization_id='cfa10000-0000-4000-8000-000000000001';

CREATE TEMP TABLE merge_workbook_receipts AS
SELECT plugin_data.csf_merge_profiles(
'cfa10000-0000-4000-8000-000000000001','cfa30000-0000-4000-8000-000000000001',
'cfa30000-0000-4000-8000-000000000002','Officer verified the fictional duplicate records.',
'cfa00000-0000-4000-8000-000000000001','cfa80000-0000-4000-8000-000000000001') AS receipt;
SELECT extensions.is((SELECT profile_id FROM plugin_data.csf_reviewed_workbook_profile_links WHERE revoked_at IS NULL),
'cfa30000-0000-4000-8000-000000000002'::uuid,'active lineage follows the surviving profile');
SELECT extensions.ok(NOT EXISTS(
SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links l JOIN before_workbook_links b USING(id)
WHERE l.revoked_at IS NOT NULL AND to_jsonb(l) IS DISTINCT FROM b.snapshot),'revoked evidence is byte-for-byte unchanged');
SELECT extensions.ok(NOT EXISTS(
SELECT 1 FROM plugin_data.csf_reviewed_workbook_profile_links l JOIN before_workbook_links b USING(id)
WHERE l.revoked_at IS NULL AND (to_jsonb(l)-'profile_id') IS DISTINCT FROM (b.snapshot-'profile_id')),
'active links preserve the original officer, request, source key, and evidence');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target(
'cfa10000-0000-4000-8000-000000000001','cfa60000-0000-4000-8000-000000000003'),
'cfa30000-0000-4000-8000-000000000002'::uuid,'later semester reuse resolves the survivor');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
WHERE action='profile_merge.workbook_links_reassigned' AND organization_id='cfa10000-0000-4000-8000-000000000001'),1,
'merge writes one link ownership audit');
SELECT extensions.ok(EXISTS(SELECT 1 FROM plugin_data.csf_admin_audit_events a JOIN before_workbook_links b
ON a.before_data->'workbookLinks' @> jsonb_build_array(b.snapshot)
WHERE a.action='profile_merge.workbook_links_reassigned' AND b.snapshot->>'revoked_at' IS NULL),
'audit retains the complete original active-link evidence');
SELECT extensions.is(plugin_data.csf_merge_profiles(
'cfa10000-0000-4000-8000-000000000001','cfa30000-0000-4000-8000-000000000001',
'cfa30000-0000-4000-8000-000000000002','Officer verified the fictional duplicate records.',
'cfa00000-0000-4000-8000-000000000001','cfa80000-0000-4000-8000-000000000001'),
(SELECT receipt FROM merge_workbook_receipts),'lost response returns the exact saved receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
WHERE action='profile_merge.workbook_links_reassigned' AND organization_id='cfa10000-0000-4000-8000-000000000001'),1,
'replay creates no second link ownership audit');
SELECT extensions.ok(NOT has_function_privilege('service_role',
'plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid)','EXECUTE'),
'service callers cannot bypass the audited request wrapper');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
'plugin_data.csf_profile_merge_reference_plan(uuid,uuid)','EXECUTE'),'reference evidence remains internal');
SELECT * FROM extensions.finish();
ROLLBACK;
