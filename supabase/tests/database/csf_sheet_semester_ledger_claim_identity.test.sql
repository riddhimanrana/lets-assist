BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(29);

SELECT extensions.dblink_connect('semester_claim_merge_lock',
  'hostaddr='||coalesce(host(inet_server_addr()),'127.0.0.1')||
  ' port='||current_setting('port')||' dbname='||current_database()||
  ' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_exec('semester_claim_merge_lock','SET lock_timeout=''750ms''');
SELECT plugin_data.csf_lock_identity_mutation('cff10000-0000-4000-8000-000000000001');
SELECT extensions.dblink_send_query('semester_claim_merge_lock',$query$
  SELECT plugin_data.csf_claim_sheet_semester_ledger_write(
    'cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001',
    'cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000001',
    'cff40000-0000-4000-8000-000000000001','fixture-version',repeat('a',64),
    '{}'::jsonb,'cffc0000-0000-4000-8000-000000000001')::text
$query$);
SELECT * FROM extensions.dblink_get_result('semester_claim_merge_lock',false)
  AS result(payload text);
SELECT extensions.ok(position('canceling statement due to lock timeout' IN
  extensions.dblink_error_message('semester_claim_merge_lock'))>0,
  'a claim waits on the same identity lock used by a target-profile merge');
SELECT extensions.dblink_disconnect('semester_claim_merge_lock');
SELECT extensions.ok((SELECT position('csf_staff_access_lock_key(p_organization_id)' IN body)>0
  AND position('csf_staff_access_lock_key(p_organization_id)' IN body)
    < position('csf_lock_identity_mutation(p_organization_id)' IN body)
  AND position('csf_lock_identity_mutation(p_organization_id)' IN body)
    < position('SELECT * INTO m' IN body)
  FROM (SELECT pg_get_functiondef(
    'plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)'::regprocedure) body) definition),
  'claim takes staff then identity locks before reading the reviewed mapping');

SELECT extensions.ok((SELECT count(*)=1 FROM aclexplode(
  (SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('plugin_data.csf_guard_sheet_semester_ledger_immutable()'))) a
  WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE'),
  'immutable-write trigger has an explicit postgres execute grant');
SELECT extensions.ok((SELECT count(*)=1 FROM aclexplode(
  (SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('plugin_data.csf_guard_semester_write_link_owner()'))) a
  WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE'),
  'link-owner trigger has an explicit postgres execute grant');
SELECT extensions.ok((SELECT count(*)=1 FROM aclexplode(
  (SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('plugin_data.csf_guard_workbook_link_unsettled_write()'))) a
  WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE'),
  'workbook-link trigger has an explicit postgres execute grant');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('cff00000-0000-4000-8000-000000000001','authenticated','authenticated','officer@fixture.test',now(),'{}','{}'),
('cff00000-0000-4000-8000-000000000002','authenticated','authenticated','outsider@fixture.test',now(),'{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('cff10000-0000-4000-8000-000000000001','Ledger fixture','ledger-fixture','school','612482');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES ('cff20000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('cff30000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,school_email,normalized_school_email)
VALUES ('cff40000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test'),
('cff40000-0000-4000-8000-000000000002','cff10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
VALUES ('cff10000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','active'),
('cff10000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000002','cff20000-0000-4000-8000-000000000001','active');
INSERT INTO plugin_data.csf_class_workbooks(organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,state)
VALUES ('cff10000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','fixture-original-ledger','cff00000-0000-4000-8000-000000000001','1','linked');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id)
VALUES ('cff50000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','class_history','Fixture','google_sheets','fixture-original-ledger');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id,mode,status,source_type,source_file_id)
VALUES ('cff60000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff50000-0000-4000-8000-000000000001','preview','needs_resolution','class_history','fixture-original-ledger');
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,matched_profile_id,import_status)
VALUES ('cff70000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff60000-0000-4000-8000-000000000001','cff50000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','F39',2,'{"record":{"identity":{"firstName":"Fixture","lastName":"Learner","normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"FixtureLearner"}}}','cff40000-0000-4000-8000-000000000001','created');
INSERT INTO plugin_data.csf_reviewed_workbook_profile_links(id,organization_id,cohort_id,source_file_id,source_key,profile_id,reviewed_row_id,authorized_by,request_id,reason)
VALUES ('cff80000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','fixture-original-ledger','FixtureLearner','cff40000-0000-4000-8000-000000000001','cff70000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000002','Fictional reviewed identity.');
INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by,privacy_verified_at,comment_capability)
VALUES ('cff90000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','fixture-ledger-copy',1,'class','cff20000-0000-4000-8000-000000000001','cff30000-0000-4000-8000-000000000001',false,'cff00000-0000-4000-8000-000000000001',now(),'available');
INSERT INTO plugin_data.csf_sheet_sync_acceptances(id,organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason)
VALUES ('cffa0000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff90000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','{}','{}','Fixture acceptance.');
INSERT INTO plugin_data.csf_sheet_semester_ledger_mappings(id,organization_id,destination_id,source_file_id,cohort_id,term_id,acceptance_id,layout,accepted_by)
VALUES ('cffb0000-0000-4000-8000-000000000001','cff10000-0000-4000-8000-000000000001','cff90000-0000-4000-8000-000000000001','fixture-original-ledger','cff20000-0000-4000-8000-000000000001','cff30000-0000-4000-8000-000000000001','cffa0000-0000-4000-8000-000000000001','{"headerRowIndex":1,"firstDataRowIndex":2,"lastDataRowIndex":10,"firstWritableColumn":4,"lastWritableColumn":4,"activityColumns":[4],"meetingColumns":[]}','cff00000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_cohort_terms(organization_id,cohort_id,term_id)
VALUES ('cff10000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','cff30000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_reviewed_workbook_profile_links(id,organization_id,cohort_id,source_file_id,source_key,profile_id,reviewed_row_id,authorized_by,request_id,reason)
VALUES ('cff80000-0000-4000-8000-000000000003','cff10000-0000-4000-8000-000000000001','cff20000-0000-4000-8000-000000000001','fixture-original-ledger','FixtureLearnerAlias','cff40000-0000-4000-8000-000000000001','cff70000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000004','Fictional second reviewed identity.');

CREATE TEMP TABLE claim_fixture(version text, plan jsonb);
INSERT INTO claim_fixture VALUES (
  md5(plugin_data.csf_sheet_sync_destination_snapshot('cff10000-0000-4000-8000-000000000001','cff90000-0000-4000-8000-000000000001','profile','cff40000-0000-4000-8000-000000000001')::text),
  '{"rowIndex":2,"changes":[{"rowIndex":2,"columnIndex":4,"expectedValue":"","value":"2","evidenceId":"fixture"}]}'::jsonb);
SELECT extensions.is(
  (SELECT plugin_data.csf_claim_sheet_semester_ledger_write('cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000001',version,repeat('a',64),plan,'cffc0000-0000-4000-8000-000000000001')->>'claimed_now' FROM claim_fixture),
  'true','first reviewed claim is recorded');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET privacy_verified_at=NULL WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'privacy deauthorization cannot race a claimed provider write');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET spreadsheet_file_id='fixture-other-ledger-copy' WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'destination file identity cannot change during a claim');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET sheet_id=2 WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'destination tab identity cannot change during a claim');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET enabled=true WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'destination cannot be enabled during a claimed direct write');
SELECT extensions.lives_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET last_synced_at=now() WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  'routine destination polling metadata remains writable');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_sheet_sync_destinations
  WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'destination deletion cannot cascade away an unsettled receipt');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_sheet_semester_ledger_mappings
  WHERE id='cffb0000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before deleting its mapping.',
  'accepted mapping deletion cannot cascade away an unsettled receipt');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_reviewed_workbook_profile_links
  SET source_key='ChangedKey' WHERE id='cff80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.',
  'reviewed source identity cannot change during an unsettled write');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_profile_cohort_memberships
  SET status='archived' WHERE profile_id='cff40000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing this membership.',
  'cohort membership cannot be deactivated during a claim');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_profile_cohort_memberships
  WHERE profile_id='cff40000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing this membership.',
  'cohort membership cannot be deleted during a claim');
SELECT extensions.lives_ok($$UPDATE plugin_data.csf_profile_cohort_memberships
  SET updated_at=now() WHERE profile_id='cff40000-0000-4000-8000-000000000001'$$,
  'routine membership metadata remains writable');
SELECT extensions.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(plugin_data.csf_profile_merge_preview(
  'cff10000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000002',
  'cff40000-0000-4000-8000-000000000001')->'conflicts') conflict
  WHERE conflict->>'type'='semester_sheet_write_needs_reconciliation'),
  'a target-profile claim blocks a subsequent source-to-target merge');
SELECT extensions.is(
  (SELECT plugin_data.csf_claim_sheet_semester_ledger_write('cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000001',version,repeat('a',64),plan,'cffc0000-0000-4000-8000-000000000001')->>'claimed_now' FROM claim_fixture),
  'false','same identity and plan safely replay');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_claim_sheet_semester_ledger_write(
  'cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000003','cff40000-0000-4000-8000-000000000001',
  (SELECT version FROM claim_fixture),repeat('a',64),(SELECT plan FROM claim_fixture),'cffc0000-0000-4000-8000-000000000001')$$,
  '23505','This write request conflicts with its original plan.','request ID cannot replay against another reviewed source link');
SELECT extensions.is(plugin_data.csf_finish_sheet_semester_ledger_write(
  'cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001',
  'cffc0000-0000-4000-8000-000000000001','aborted',NULL)->>'status',
  'aborted','provider non-write settles the original attempt');
SELECT extensions.is(
  (SELECT plugin_data.csf_claim_sheet_semester_ledger_write('cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000001',version,repeat('a',64),plan,'cffc0000-0000-4000-8000-000000000002')->>'claimed_now' FROM claim_fixture),
  'true','same source version and preview can be retried with a new request after abort');
SELECT extensions.is(plugin_data.csf_finish_sheet_semester_ledger_write(
  'cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001',
  'cffc0000-0000-4000-8000-000000000002','unknown_outcome',NULL)->>'status',
  'unknown_outcome','ambiguous provider outcome remains unsettled');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_sync_destinations
  SET privacy_verified_at=NULL WHERE id='cff90000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before changing its destination.',
  'privacy deauthorization remains fenced during an unknown outcome');
SELECT extensions.ok((SELECT count(*)=1 FROM pg_index i WHERE
  i.indexrelid=to_regclass('plugin_data.csf_sheet_semester_ledger_nonaborted_receipt_unique')
  AND i.indisunique AND pg_get_expr(i.indpred,i.indrelid) LIKE '%aborted%'),
  'deduplication excludes aborted attempts while retaining their receipts');
UPDATE plugin_data.csf_profiles SET first_name='Updated' WHERE id='cff40000-0000-4000-8000-000000000001';
SELECT extensions.isnt(
  (SELECT version FROM claim_fixture),
  md5(plugin_data.csf_sheet_sync_destination_snapshot('cff10000-0000-4000-8000-000000000001','cff90000-0000-4000-8000-000000000001','profile','cff40000-0000-4000-8000-000000000001')::text),
  'fixture profile edit changes current source version');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_claim_sheet_semester_ledger_write(
  'cff10000-0000-4000-8000-000000000001','cff00000-0000-4000-8000-000000000001','cffb0000-0000-4000-8000-000000000001','cff80000-0000-4000-8000-000000000001','cff40000-0000-4000-8000-000000000001',
  md5(plugin_data.csf_sheet_sync_destination_snapshot('cff10000-0000-4000-8000-000000000001','cff90000-0000-4000-8000-000000000001','profile','cff40000-0000-4000-8000-000000000001')::text),
  repeat('a',64),(SELECT plan FROM claim_fixture),'cffc0000-0000-4000-8000-000000000001')$$,
  '23505','This write request conflicts with its original plan.','request ID cannot replay after source version changes');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_sheet_semester_ledger_writes),2,
  'only the authorized retry creates another receipt');
SELECT extensions.ok((SELECT count(*)=1 FROM plugin_data.csf_admin_audit_events
  WHERE action='sheet_sync.semester_write_claimed' AND target_id='cffc0000-0000-4000-8000-000000000001'),
  'conflicting retries make no duplicate audit');
SELECT * FROM extensions.finish();
ROLLBACK;
