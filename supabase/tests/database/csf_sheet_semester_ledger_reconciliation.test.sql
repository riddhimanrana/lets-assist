BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(31);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('cfe00000-0000-4000-8000-000000000001','authenticated','authenticated','officer@fixture.test',now(),'{}','{}'),
('cfe00000-0000-4000-8000-000000000002','authenticated','authenticated','outsider@fixture.test',now(),'{}','{}');
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('cfe10000-0000-4000-8000-000000000001','Ledger fixture','ledger-fixture','school','612482');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label)
VALUES ('cfe20000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001',2040,'Class of 2040');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester)
VALUES ('cfe30000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','F39','Fall 2039','2039-2040','fall');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,school_email,normalized_school_email)
VALUES ('cfe40000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test'),
('cfe40000-0000-4000-8000-000000000002','cfe10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test');
INSERT INTO plugin_data.csf_profile_cohort_memberships(organization_id,profile_id,cohort_id,status)
VALUES ('cfe10000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe20000-0000-4000-8000-000000000001','active'),
('cfe10000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000002','cfe20000-0000-4000-8000-000000000001','active');
INSERT INTO plugin_data.csf_class_workbooks(organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,state)
VALUES ('cfe10000-0000-4000-8000-000000000001','cfe20000-0000-4000-8000-000000000001','fixture-original-ledger','cfe00000-0000-4000-8000-000000000001','1','linked');
INSERT INTO plugin_data.csf_sheet_sources(id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id)
VALUES ('cfe50000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe20000-0000-4000-8000-000000000001','class_history','Fixture','google_sheets','fixture-original-ledger');
INSERT INTO plugin_data.csf_sheet_import_jobs(id,organization_id,source_id,mode,status,source_type,source_file_id)
VALUES ('cfe60000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe50000-0000-4000-8000-000000000001','preview','needs_resolution','class_history','fixture-original-ledger');
INSERT INTO plugin_data.csf_sheet_import_rows(id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,matched_profile_id,import_status)
VALUES ('cfe70000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe60000-0000-4000-8000-000000000001','cfe50000-0000-4000-8000-000000000001','cfe20000-0000-4000-8000-000000000001','F39',2,'{"record":{"identity":{"firstName":"Fixture","lastName":"Learner","normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"FixtureLearner"}}}','cfe40000-0000-4000-8000-000000000001','created');
INSERT INTO plugin_data.csf_reviewed_workbook_profile_links(id,organization_id,cohort_id,source_file_id,source_key,profile_id,reviewed_row_id,authorized_by,request_id,reason)
VALUES ('cfe80000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe20000-0000-4000-8000-000000000001','fixture-original-ledger','FixtureLearner','cfe40000-0000-4000-8000-000000000001','cfe70000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfe80000-0000-4000-8000-000000000002','Fictional reviewed identity.');
INSERT INTO plugin_data.csf_sheet_sync_destinations(id,organization_id,spreadsheet_file_id,sheet_id,kind,cohort_id,term_id,is_test,configured_by,privacy_verified_at,comment_capability)
VALUES ('cfe90000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','fixture-ledger-copy',1,'class','cfe20000-0000-4000-8000-000000000001','cfe30000-0000-4000-8000-000000000001',false,'cfe00000-0000-4000-8000-000000000001',now(),'available');
INSERT INTO plugin_data.csf_sheet_sync_acceptances(id,organization_id,destination_id,test_organization_id,reviewed_by,configuration,evidence,reason)
VALUES ('cfea0000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','{}','{}','Fixture acceptance.');
INSERT INTO plugin_data.csf_sheet_semester_ledger_mappings(id,organization_id,destination_id,source_file_id,cohort_id,term_id,acceptance_id,layout,accepted_by)
VALUES ('cfeb0000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001','fixture-original-ledger','cfe20000-0000-4000-8000-000000000001','cfe30000-0000-4000-8000-000000000001','cfea0000-0000-4000-8000-000000000001','{}','cfe00000-0000-4000-8000-000000000001');
INSERT INTO plugin_data.csf_sheet_semester_ledger_writes(request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,actor_user_id,source_version,preview_digest,plan)
VALUES ('cfec0000-0000-4000-8000-000000000001','cfe10000-0000-4000-8000-000000000001','cfeb0000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001','cfe80000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','v1',repeat('a',64),'{}');

SELECT extensions.ok(NOT has_table_privilege('service_role','plugin_data.csf_sheet_semester_ledger_writes','UPDATE'),
  'service role cannot bypass reconciliation with direct row updates');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)','EXECUTE')
  AND has_function_privilege('service_role',
  'plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)','EXECUTE'),
  'only the authorized server may reconcile');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000002','cfec0000-0000-4000-8000-000000000001',true,repeat('b',64),'Provider row checked and matched.')$$,
  '42501','Not authorized.','outsider cannot reconcile');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001',true,repeat('b',64),'Provider row checked and matched.')$$,
  '55000','Only an ambiguous semester write can be reconciled.','claimed writes cannot skip the provider outcome');
SELECT extensions.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(plugin_data.csf_profile_merge_preview(
  'cfe10000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000002')->'conflicts') c
  WHERE c->>'type'='semester_sheet_write_needs_reconciliation'),'merge preview blocks a claimed write');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_reviewed_workbook_profile_links SET profile_id='cfe40000-0000-4000-8000-000000000002' WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','link transfer is blocked during claimed writes');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_revoke_workbook_profile_link('cfe10000-0000-4000-8000-000000000001','cfe80000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','Fixture link correction.')$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','officer revocation is blocked while a provider write is claimed');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_reviewed_workbook_profile_links
  SET revoked_at=now(),revoked_by='cfe00000-0000-4000-8000-000000000001',revocation_reason='Fixture correction.'
  WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','direct revocation is blocked while a provider write is claimed');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_reviewed_workbook_profile_links WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','link deletion is blocked while a provider write is claimed');
SELECT plugin_data.csf_finish_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001','unknown_outcome',NULL);
SELECT extensions.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(plugin_data.csf_profile_merge_preview(
  'cfe10000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000002')->'conflicts') c
  WHERE c->>'type'='semester_sheet_write_needs_reconciliation'),'merge preview exposes the unsettled write blocker');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_reviewed_workbook_profile_links SET profile_id='cfe40000-0000-4000-8000-000000000002' WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','link transfer is blocked during unknown outcome');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_reviewed_workbook_profile_links
  SET revoked_at=now(),revoked_by='cfe00000-0000-4000-8000-000000000001',revocation_reason='Fixture correction.'
  WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','direct revocation is blocked during an unknown provider outcome');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_reviewed_workbook_profile_links WHERE id='cfe80000-0000-4000-8000-000000000001'$$,
  '55000','Reconcile the semester Sheet write before moving this workbook link.','link deletion is blocked during an unknown provider outcome');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_merge_profiles('cfe10000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000002','Officer verified duplicate fixture profiles.','cfe00000-0000-4000-8000-000000000001','cfed0000-0000-4000-8000-000000000001')$$,
  'P0001',NULL,'merge execution rejects the unresolved write');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001',true,NULL,'Provider row checked and matched.')$$,
  '22023','Record the checked provider readback and a review reason.','written outcome requires a readback digest');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001',true,repeat('b',64),'Provider row checked and matched.')->>'status',
  'applied','officer can settle a confirmed provider write');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001',true,repeat('b',64),'Provider row checked and matched.')->>'replayed',
  'true','same reconciliation replays without a second write');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000001',false,NULL,'Provider row checked and matched.')$$,
  '55000','Only an ambiguous semester write can be reconciled.','opposite outcome cannot replay');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id='cfec0000-0000-4000-8000-000000000001' AND action='sheet_sync.semester_write_reconciled'),1,
  'successful reconciliation has one audit event');
SELECT extensions.throws_ok($$UPDATE plugin_data.csf_sheet_semester_ledger_writes SET plan='{"altered":true}' WHERE request_id='cfec0000-0000-4000-8000-000000000001'$$,
  '23514','Semester write identity and evidence are immutable.','evidence remains immutable after settlement');
INSERT INTO plugin_data.csf_sheet_semester_ledger_writes(request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,actor_user_id,source_version,preview_digest,plan)
VALUES ('cfec0000-0000-4000-8000-000000000002','cfe10000-0000-4000-8000-000000000001','cfeb0000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001','cfe80000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','v2',repeat('c',64),'{}');
SELECT plugin_data.csf_finish_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000002','unknown_outcome',NULL);
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000002',false,NULL,'Provider row checked and was unchanged.')->>'status',
  'aborted','officer can settle a confirmed non-write');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000002',false,NULL,'Provider row checked and was unchanged.')->>'replayed',
  'true','confirmed non-write replay is idempotent');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action='sheet_sync.semester_write_reconciled'),2,
  'both ambiguous outcomes retain distinct audit receipts');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM plugin_data.csf_sheet_semester_ledger_writes WHERE status IN ('claimed','unknown_outcome')),
  'reconciled writes no longer block identity lifecycle');
INSERT INTO plugin_data.csf_sheet_semester_ledger_writes
  (request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,actor_user_id,
    source_version,preview_digest,plan,lease_expires_at)
VALUES ('cfec0000-0000-4000-8000-000000000003','cfe10000-0000-4000-8000-000000000001',
  'cfeb0000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001',
  'cfe80000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001',
  'cfe00000-0000-4000-8000-000000000001','v3',repeat('d',64),'{}',clock_timestamp()-interval '1 minute');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000003',false,NULL,'Provider row checked and was unchanged.')->>'status',
  'aborted','expired claim can be recovered as a confirmed non-write');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
  WHERE target_id='cfec0000-0000-4000-8000-000000000003'
    AND action='sheet_sync.semester_write_expired_recovered'),1,
  'expired claim recovery records one audit transition');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000003',false,NULL,'Provider row checked and was unchanged.')->>'replayed',
  'true','expired claim reconciliation replays without a second recovery');
INSERT INTO plugin_data.csf_sheet_semester_ledger_writes
  (request_id,organization_id,mapping_id,destination_id,source_link_id,profile_id,actor_user_id,
    source_version,preview_digest,plan,lease_expires_at)
VALUES ('cfec0000-0000-4000-8000-000000000004','cfe10000-0000-4000-8000-000000000001',
  'cfeb0000-0000-4000-8000-000000000001','cfe90000-0000-4000-8000-000000000001',
  'cfe80000-0000-4000-8000-000000000001','cfe40000-0000-4000-8000-000000000001',
  'cfe00000-0000-4000-8000-000000000001','v4',repeat('e',64),'{}',clock_timestamp()-interval '1 minute');
SELECT extensions.is(plugin_data.csf_reconcile_sheet_semester_ledger_write('cfe10000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','cfec0000-0000-4000-8000-000000000004',true,repeat('f',64),'Provider row checked and matched.')->>'status',
  'applied','expired claim can be recovered as a confirmed write');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
  WHERE target_id='cfec0000-0000-4000-8000-000000000004'
    AND action='sheet_sync.semester_write_expired_recovered'),1,
  'confirmed expired write has one recovery audit transition');
SELECT extensions.is(plugin_data.csf_revoke_workbook_profile_link('cfe10000-0000-4000-8000-000000000001','cfe80000-0000-4000-8000-000000000001','cfe00000-0000-4000-8000-000000000001','Fixture link correction.')->>'status',
  'revoked','officer may revoke the link after all writes settle');
SELECT extensions.ok((SELECT revoked_at IS NOT NULL FROM plugin_data.csf_reviewed_workbook_profile_links
  WHERE id='cfe80000-0000-4000-8000-000000000001'),
  'settled revocation persists within the transaction');
SELECT * FROM extensions.finish();
ROLLBACK;
