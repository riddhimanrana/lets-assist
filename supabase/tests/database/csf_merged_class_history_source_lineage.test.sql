BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('cfb00000-0000-4000-8000-000000000001','authenticated','authenticated','lineage-officer@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('cfb10000-0000-4000-8000-000000000001','Lineage fixture','lineage-fixture','school','975382');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('cfb10000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_cohorts (id,organization_id,graduation_year,label)
VALUES ('cfb20000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001',2041,'Class of 2041');
INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,school_email,normalized_school_email,record_status,merged_into_profile_id,merged_at,merged_by,merge_reason)
VALUES
  ('cfb30000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test','merged','cfb30000-0000-4000-8000-000000000002',now(),'cfb00000-0000-4000-8000-000000000001','Reviewed fixture merge.'),
  ('cfb30000-0000-4000-8000-000000000002','cfb10000-0000-4000-8000-000000000001','Fixture','Learner','fixture','learner','fixture@local.test','fixture@local.test','active',NULL,NULL,NULL,NULL);
INSERT INTO plugin_data.csf_profile_cohort_memberships (organization_id,profile_id,cohort_id,status)
VALUES
  ('cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000002','cfb20000-0000-4000-8000-000000000001','active');
INSERT INTO plugin_data.csf_class_workbooks (organization_id,cohort_id,drive_file_id,drive_owner_user_id,provider_version,state)
VALUES ('cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','lineage-workbook','cfb00000-0000-4000-8000-000000000001','1','linked');
INSERT INTO plugin_data.csf_sheet_sources (id,organization_id,cohort_id,source_type,title,provider,spreadsheet_id)
VALUES ('cfb40000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','class_history','Lineage workbook','google_sheets','lineage-workbook');
INSERT INTO plugin_data.csf_sheet_import_jobs (id,organization_id,source_id,mode,status,source_type,source_file_id)
SELECT ('cfb50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'cfb10000-0000-4000-8000-000000000001','cfb40000-0000-4000-8000-000000000001',
  'preview','needs_resolution','class_history','lineage-workbook'
FROM generate_series(1,5) n;
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,matched_profile_id,import_status)
VALUES
  ('cfb60000-0000-4000-8000-000000000001','cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000001','cfb40000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','F40',2,'{"record":{"identity":{"normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"fixturelearner"},"contact":{"schoolEmail":"fixture@local.test"}}}','cfb30000-0000-4000-8000-000000000001','created'),
  ('cfb60000-0000-4000-8000-000000000002','cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000002','cfb40000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','S41',2,'{"record":{"identity":{"normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"fixturelearner"},"contact":{"schoolEmail":"fixture@local.test"}}}',NULL,'ambiguous'),
  ('cfb60000-0000-4000-8000-000000000003','cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000003','cfb40000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','S41',3,'{"record":{"identity":{"normalizedFirstName":"fixture","normalizedLastName":"learner","sourceStudentKey":"fixturelearner"}}}',NULL,'ambiguous');

INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,status,requested_by,reviewed_by,reviewed_at,notes)
VALUES ('cfb80000-0000-4000-8000-000000000000','cfb10000-0000-4000-8000-000000000001',
  'cfb30000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000002',
  'Officer reviewed the fictional duplicate records.','approved','cfb00000-0000-4000-8000-000000000001',
  'cfb00000-0000-4000-8000-000000000001',now(),'Approved fictional merge lineage.');

SELECT extensions.ok(
  (SELECT matched_profile_id='cfb30000-0000-4000-8000-000000000001'::uuid
   FROM plugin_data.csf_sheet_import_rows WHERE id='cfb60000-0000-4000-8000-000000000001'),
  'settled import lineage remains immutable after merge');
SELECT extensions.is(plugin_data.csf_reviewed_merge_survivor(
  'cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000001'),
  'cfb30000-0000-4000-8000-000000000002'::uuid,
  'approved merge lineage resolves the active survivor');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000002'),
  'cfb30000-0000-4000-8000-000000000002'::uuid,
  'contact-corroborated reimport reuses the reviewed merge survivor');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000003'),
  NULL::uuid,'name-only merged lineage is not automatic ownership evidence');
SELECT extensions.ok(plugin_data.csf_class_history_source_key_requires_review(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000003'),
  'name-only merged lineage is held for staff review instead of creating a profile');

SELECT extensions.throws_ok($test$SELECT plugin_data.csf_import_class_history_row_v2(
  'cfb10000-0000-4000-8000-000000000001',NULL,
  'Fixture','Learner',NULL,NULL,'fixture','learner',NULL,NULL,
  'cfb20000-0000-4000-8000-000000000001',NULL,
  'cfb40000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000003',
  'fictional-row-hash','[]','[]',false,'cfb00000-0000-4000-8000-000000000001')$test$,
  '23514','This workbook key needs officer review before another profile can be created.',
  'the atomic importer cannot create a profile for unreviewed merged lineage');

SELECT plugin_data.csf_confirm_workbook_profile_link(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000003',
  'cfb30000-0000-4000-8000-000000000002','cfb00000-0000-4000-8000-000000000001',
  'cfb70000-0000-4000-8000-000000000002','Officer reviewed the immutable workbook lineage.');
SELECT extensions.is(plugin_data.csf_class_history_source_key_target(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000003'),
  'cfb30000-0000-4000-8000-000000000002'::uuid,
  'explicit workbook review authorizes later name-only reuse of the survivor');

INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,record_status,merged_into_profile_id,merged_at,merged_by,merge_reason)
VALUES ('cfb30000-0000-4000-8000-000000000003','cfb10000-0000-4000-8000-000000000001',
  'Broken','Lineage','broken','lineage','merged','cfb30000-0000-4000-8000-000000000002',now(),'cfb00000-0000-4000-8000-000000000001','Malformed fixture merge.');
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,matched_profile_id,import_status)
VALUES ('cfb60000-0000-4000-8000-000000000004','cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000004','cfb40000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','F40',4,
  '{"record":{"identity":{"normalizedFirstName":"broken","normalizedLastName":"lineage","sourceStudentKey":"brokenlineage"}}}',
  'cfb30000-0000-4000-8000-000000000003','created');
INSERT INTO plugin_data.csf_sheet_import_rows
  (id,organization_id,job_id,source_id,cohort_id,sheet_tab_name,row_number,normalized_data,import_status)
VALUES ('cfb60000-0000-4000-8000-000000000005','cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000005','cfb40000-0000-4000-8000-000000000001','cfb20000-0000-4000-8000-000000000001','S41',4,
  '{"record":{"identity":{"normalizedFirstName":"broken","normalizedLastName":"lineage","sourceStudentKey":"brokenlineage"}}}','ambiguous');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_class_history_source_key_target(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000005')$test$,
  '23514','The historical CSF profile merge lineage is missing, cyclic, or ambiguous.',
  'an unreviewed merge pointer fails closed');
SELECT extensions.ok(plugin_data.csf_class_history_source_key_requires_review(
  'cfb10000-0000-4000-8000-000000000001','cfb60000-0000-4000-8000-000000000005'),
  'malformed merged lineage remains in staff review');

INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES ('cfb30000-0000-4000-8000-000000000004','cfb10000-0000-4000-8000-000000000001',
  'Other','Survivor','other','survivor');
INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,evidence,status,requested_by,
   reviewed_by,reviewed_at,notes,correlation_id,source_snapshot,target_snapshot,conflict_snapshot)
SELECT 'cfb80000-0000-4000-8000-000000000001',organization_id,
  'cfb30000-0000-4000-8000-000000000003','cfb30000-0000-4000-8000-000000000002',reason,evidence,'approved',requested_by,
  reviewed_by,reviewed_at,notes,'cfb90000-0000-4000-8000-000000000001',source_snapshot,target_snapshot,conflict_snapshot
FROM plugin_data.csf_profile_merge_reviews
WHERE organization_id='cfb10000-0000-4000-8000-000000000001' LIMIT 1;
INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,evidence,status,requested_by,
   reviewed_by,reviewed_at,notes,correlation_id,source_snapshot,target_snapshot,conflict_snapshot)
SELECT 'cfb80000-0000-4000-8000-000000000002',organization_id,
  'cfb30000-0000-4000-8000-000000000003','cfb30000-0000-4000-8000-000000000004',reason,evidence,'approved',requested_by,
  reviewed_by,reviewed_at,notes,'cfb90000-0000-4000-8000-000000000002',source_snapshot,target_snapshot,conflict_snapshot
FROM plugin_data.csf_profile_merge_reviews
WHERE organization_id='cfb10000-0000-4000-8000-000000000001' LIMIT 1;
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_reviewed_merge_survivor(
  'cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000003')$test$,
  '23514','The historical CSF profile merge lineage is missing, cyclic, or ambiguous.',
  'two reviewed active survivors fail closed even when the stored pointer names one');

DELETE FROM plugin_data.csf_profile_merge_reviews
WHERE id='cfb80000-0000-4000-8000-000000000002';
INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,record_status,merged_into_profile_id,merged_at,merged_by,merge_reason)
VALUES ('cfb30000-0000-4000-8000-000000000006','cfb10000-0000-4000-8000-000000000001',
  'Dead','Branch','dead','branch','merged','cfb30000-0000-4000-8000-000000000002',now(),
  'cfb00000-0000-4000-8000-000000000001','Incomplete reviewed branch fixture.');
INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,status,requested_by,reviewed_by,reviewed_at,notes)
VALUES ('cfb80000-0000-4000-8000-000000000006','cfb10000-0000-4000-8000-000000000001',
  'cfb30000-0000-4000-8000-000000000003','cfb30000-0000-4000-8000-000000000006',
  'Malformed branch fixture.','approved','cfb00000-0000-4000-8000-000000000001',
  'cfb00000-0000-4000-8000-000000000001',now(),'Synthetic malformed branch.');
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_reviewed_merge_survivor(
  'cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000003')$test$,
  '23514','The historical CSF profile merge lineage is missing, cyclic, or ambiguous.',
  'an invalid terminal branch cannot hide beside a valid survivor');
DELETE FROM plugin_data.csf_profile_merge_reviews
WHERE id='cfb80000-0000-4000-8000-000000000006';
INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,record_status,merged_into_profile_id,merged_at,merged_by,merge_reason)
VALUES ('cfb30000-0000-4000-8000-000000000005','cfb10000-0000-4000-8000-000000000001',
  'Cycle','Node','cycle','node','merged','cfb30000-0000-4000-8000-000000000003',now(),'cfb00000-0000-4000-8000-000000000001','Cyclic fixture merge.');
INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,evidence,status,requested_by,
   reviewed_by,reviewed_at,notes,correlation_id,source_snapshot,target_snapshot,conflict_snapshot)
SELECT ('cfb80000-0000-4000-8000-00000000000'||n)::uuid,organization_id,
  CASE n WHEN 3 THEN 'cfb30000-0000-4000-8000-000000000003'::uuid ELSE 'cfb30000-0000-4000-8000-000000000005'::uuid END,
  CASE n WHEN 3 THEN 'cfb30000-0000-4000-8000-000000000005'::uuid ELSE 'cfb30000-0000-4000-8000-000000000003'::uuid END,
  reason,evidence,'approved',requested_by,reviewed_by,reviewed_at,notes,
  ('cfb90000-0000-4000-8000-00000000000'||n)::uuid,source_snapshot,target_snapshot,conflict_snapshot
FROM plugin_data.csf_profile_merge_reviews CROSS JOIN generate_series(3,4) n
WHERE id='cfb80000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($test$SELECT plugin_data.csf_reviewed_merge_survivor(
  'cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000003')$test$,
  '23514','The historical CSF profile merge lineage is missing, cyclic, or ambiguous.',
  'a reviewed cycle fails closed even when another path reaches the stored survivor');



INSERT INTO plugin_data.csf_profiles
  (id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,record_status,merged_into_profile_id,merged_at,merged_by,merge_reason)
VALUES
  ('cfb30000-0000-4000-8000-000000000007','cfb10000-0000-4000-8000-000000000001','Old','Source','old','source','merged','cfb30000-0000-4000-8000-000000000002',now(),'cfb00000-0000-4000-8000-000000000001','Flattened chain source.'),
  ('cfb30000-0000-4000-8000-000000000008','cfb10000-0000-4000-8000-000000000001','Middle','Source','middle','source','merged','cfb30000-0000-4000-8000-000000000002',now(),'cfb00000-0000-4000-8000-000000000001','Flattened chain middle.');
INSERT INTO plugin_data.csf_profile_merge_reviews
  (id,organization_id,source_profile_id,target_profile_id,reason,status,requested_by,reviewed_by,reviewed_at,notes)
VALUES
  ('cfb80000-0000-4000-8000-000000000007','cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000007','cfb30000-0000-4000-8000-000000000008','First reviewed hop.','approved','cfb00000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',now(),'Synthetic first hop.'),
  ('cfb80000-0000-4000-8000-000000000008','cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000008','cfb30000-0000-4000-8000-000000000002','Second reviewed hop.','approved','cfb00000-0000-4000-8000-000000000001','cfb00000-0000-4000-8000-000000000001',now(),'Synthetic second hop.');
SELECT extensions.is(plugin_data.csf_reviewed_merge_survivor(
  'cfb10000-0000-4000-8000-000000000001','cfb30000-0000-4000-8000-000000000007'),
  'cfb30000-0000-4000-8000-000000000002'::uuid,
  'a flattened two-hop reviewed merge chain resolves the final survivor');

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($test$SELECT count(*) FROM plugin_data.csf_class_import_review_rows(
  'cfb10000-0000-4000-8000-000000000001','cfb50000-0000-4000-8000-000000000005',25)$test$,
  'the service review reader retains access to merged-lineage review rows');
RESET ROLE;
SELECT extensions.ok(NOT has_function_privilege('service_role',
  'plugin_data.csf_reviewed_merge_survivor(uuid,uuid)','EXECUTE'),
  'the merge-lineage helper remains owner-internal');
SELECT extensions.ok(has_function_privilege('postgres',
  'plugin_data.csf_reviewed_merge_survivor(uuid,uuid)','EXECUTE'),
  'postgres can execute the merge-lineage helper');

SELECT * FROM extensions.finish();
ROLLBACK;
