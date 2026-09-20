BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);

INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('d9000000-0000-4000-8000-000000000001','authenticated','authenticated','noop-import-officer@local.test',now(),'{}','{}',now(),now());

INSERT INTO public.organizations (id,name,username,type,join_code)
VALUES ('d9100000-0000-4000-8000-000000000001','CSF no-op import','csf-noop-import','school','917001');
INSERT INTO public.organization_members (organization_id,user_id,role,status)
VALUES ('d9100000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','admin','active');

INSERT INTO plugin_data.csf_terms (id,organization_id,code,label,school_year,semester)
VALUES ('d9200000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001','F29','Fall 2029','2029-2030','fall');
INSERT INTO plugin_data.csf_term_policies (organization_id,term_id,dues_required,dues_amount,dues_currency)
VALUES ('d9100000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',true,5,'USD');
INSERT INTO plugin_data.csf_cohorts (id,organization_id,graduation_year,label)
VALUES ('d9300000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',2031,'Class of 2031');
INSERT INTO plugin_data.csf_cohort_terms (id,organization_id,cohort_id,term_id,grade_level,sheet_tab_name)
VALUES ('d9400000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',11,'Responses');
INSERT INTO plugin_data.csf_profiles (
  id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name,source_summary
) VALUES (
  'd9500000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',
  'Casey','Nguyen','casey','nguyen','{}'
);
INSERT INTO plugin_data.csf_sheet_sources (
  id,organization_id,cohort_id,source_type,target_strategy,title,provider,
  spreadsheet_id,drive_file_id,drive_file_name,sheet_url,settings
) VALUES (
  'd9600000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001',
  'd9300000-0000-4000-8000-000000000001','application_responses','fixed','No-op source',
  'google_sheets','noop-import-sheet','noop-import-sheet','No-op source',
  'https://docs.google.com/spreadsheets/d/noop-import-sheet/edit',
  '{"sourceKind":"application_responses","mappingVersion":1}'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,
  source_file_name,source_sheet_tab,source_range,mapping_snapshot,mapping_version,source_modified_at
) VALUES
('d9700000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','preview','completed','application_responses','noop-import-sheet','No-op source','Responses','Responses!A1:Z100','{"version":1,"sourceType":"application_responses"}',1,'2029-09-01T00:00:00Z'),
('d9700000-0000-4000-8000-000000000002','d9100000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','preview','completed','application_responses','noop-import-sheet','No-op source','Responses','Responses!A1:Z100','{"version":1,"sourceType":"application_responses"}',1,'2029-09-01T00:00:00Z'),
('d9700000-0000-4000-8000-000000000003','d9100000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','preview','completed','application_responses','noop-import-sheet','No-op source','Responses','Responses!A1:Z100','{"version":1,"sourceType":"application_responses"}',1,'2029-09-01T00:05:00Z');

INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,matched_profile_id,import_status,source_modified_at
) VALUES
('d9800000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000001','d9700000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','Responses',2,'{}','{}','same-row-hash','d9500000-0000-4000-8000-000000000001','pending','2029-09-01T00:00:00Z'),
('d9800000-0000-4000-8000-000000000002','d9100000-0000-4000-8000-000000000001','d9700000-0000-4000-8000-000000000002','d9600000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','Responses',2,'{}','{}','same-row-hash','d9500000-0000-4000-8000-000000000001','pending','2029-09-01T00:00:00Z'),
('d9800000-0000-4000-8000-000000000003','d9100000-0000-4000-8000-000000000001','d9700000-0000-4000-8000-000000000003','d9600000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','Responses',2,'{}','{}','changed-row-hash','d9500000-0000-4000-8000-000000000001','pending','2029-09-01T00:05:00Z');

CREATE TEMP TABLE noop_application_data(value jsonb);
INSERT INTO noop_application_data VALUES ('{
  "sourceSubmittedAt":"2029-08-31T20:00:00Z","currentGradeLevel":11,
  "returningStatus":"returning","mostCheckedEmail":"casey@example.test",
  "listIPoints":4,"listIAndIIPoints":7,"grandTotalPoints":11,
  "transcriptDriveFileId":"noop-transcript","transcriptUrl":"https://drive.google.com/open?id=noop-transcript",
  "receiptDriveFileId":"noop-receipt","receiptUrl":"https://drive.google.com/open?id=noop-receipt",
  "courses":[{"courseList":"I","courseName":"English","grade":"A","points":4,"isBonus":false,"rawLine":"English"}],
  "missingFields":[]
}'::jsonb);

SELECT extensions.lives_ok($$
  SELECT plugin_data.csf_import_application_response_row_identity_base(
    'd9100000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
    'Casey','Nguyen',NULL,NULL,'casey','nguyen',NULL,NULL,
    'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001','d9800000-0000-4000-8000-000000000001',
    'same-row-hash',(SELECT value FROM noop_application_data),'d9000000-0000-4000-8000-000000000001')
$$,'the first snapshot creates the canonical application state');

CREATE TEMP TABLE noop_before AS
SELECT a.id,a.updated_at,a.source_import_job_id,a.source_import_row_id,
  (SELECT array_agg(c.id ORDER BY c.id) FROM plugin_data.csf_application_course_entries c WHERE c.application_id=a.id) course_ids,
  (SELECT array_agg(f.id ORDER BY f.id) FROM plugin_data.csf_application_files f WHERE f.application_id=a.id) file_ids,
  (SELECT count(*) FROM plugin_data.csf_application_status_events e WHERE e.application_id=a.id) event_count
FROM plugin_data.csf_term_applications a
WHERE a.organization_id='d9100000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (plugin_data.csf_import_application_response_row_identity_base(
    'd9100000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
    'Casey','Nguyen',NULL,NULL,'casey','nguyen',NULL,NULL,
    'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001','d9800000-0000-4000-8000-000000000002',
    'same-row-hash',(SELECT value FROM noop_application_data),'d9000000-0000-4000-8000-000000000001')->>'canonicalWriteSkipped')::boolean,
  true,'the repeated identical snapshot reports a skipped canonical write');

SELECT extensions.is(a.updated_at,b.updated_at,'the no-op preserves the application update timestamp')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(a.source_import_job_id,b.source_import_job_id,'the no-op preserves the canonical source job pointer')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(a.source_import_row_id,b.source_import_row_id,'the no-op preserves the canonical source row pointer')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(
  (SELECT array_agg(c.id ORDER BY c.id) FROM plugin_data.csf_application_course_entries c WHERE c.application_id=a.id),
  b.course_ids,'the no-op preserves course row identities')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(
  (SELECT array_agg(f.id ORDER BY f.id) FROM plugin_data.csf_application_files f WHERE f.application_id=a.id),
  b.file_ids,'the no-op preserves file row identities')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(
  (SELECT count(*) FROM plugin_data.csf_application_status_events e WHERE e.application_id=a.id),
  b.event_count,'the no-op does not append a duplicate application status event')
FROM plugin_data.csf_term_applications a CROSS JOIN noop_before b WHERE a.id=b.id;
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows WHERE id='d9800000-0000-4000-8000-000000000002'),
  'updated','the repeated preview row still records its commit result');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'
      AND action='sheets.application_response_row_imported'
      AND after_data->>'importRowId'='d9800000-0000-4000-8000-000000000002'
      AND after_data->>'canonicalWriteSkipped'='true'),
  1,'the no-op retains immutable import provenance in the audit ledger');

SELECT extensions.is(
  (plugin_data.csf_import_application_response_row_identity_base(
    'd9100000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
    'Casey','Nguyen',NULL,NULL,'casey','nguyen',NULL,NULL,
    'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001','d9800000-0000-4000-8000-000000000003',
    'changed-row-hash',
    jsonb_set((SELECT value FROM noop_application_data),'{courses,0,courseName}','"Advanced English"'),
    'd9000000-0000-4000-8000-000000000001')->>'canonicalWriteSkipped')::boolean,
  false,'a changed source row takes the canonical write path');
SELECT extensions.is(
  (SELECT source_import_job_id FROM plugin_data.csf_term_applications
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'),
  'd9700000-0000-4000-8000-000000000003'::uuid,
  'a changed row advances the canonical source job pointer');
SELECT extensions.is(
  (SELECT course_name FROM plugin_data.csf_application_course_entries
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'),
  'Advanced English','a changed row rebuilds canonical course data');
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_status_events
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'),
  2,'a changed row appends its application status event');

UPDATE plugin_data.csf_term_applications
SET assigned_to='d9000000-0000-4000-8000-000000000001',
    assigned_by='d9000000-0000-4000-8000-000000000001',
    assigned_at=now(),
    submission_status='decided',
    eligibility_status='eligible',
    decision_status='approved',
    decision_reason_code='approved_standard',
    decision_reason='Approved in the no-op regression.',
    status='accepted'
WHERE organization_id='d9100000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id,organization_id,source_id,initiated_by,mode,status,source_type,source_file_id,
  source_file_name,source_sheet_tab,source_range,mapping_snapshot,mapping_version,source_modified_at
) VALUES
('d9700000-0000-4000-8000-000000000004','d9100000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','preview','completed','application_responses','noop-import-sheet','No-op source','Responses','Responses!A1:Z100','{"version":1,"sourceType":"application_responses"}',1,'2029-09-01T00:10:00Z'),
('d9700000-0000-4000-8000-000000000005','d9100000-0000-4000-8000-000000000001','d9600000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','preview','completed','application_responses','noop-import-sheet','No-op source','Responses','Responses!A1:Z100','{"version":1,"sourceType":"application_responses"}',1,'2029-09-01T00:15:00Z');
INSERT INTO plugin_data.csf_sheet_import_rows (
  id,organization_id,job_id,source_id,cohort_id,term_id,sheet_tab_name,row_number,
  raw_data,normalized_data,row_hash,matched_profile_id,import_status,source_modified_at
) VALUES
('d9800000-0000-4000-8000-000000000004','d9100000-0000-4000-8000-000000000001','d9700000-0000-4000-8000-000000000004','d9600000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','Responses',2,'{}','{}','changed-row-hash','d9500000-0000-4000-8000-000000000001','pending','2029-09-01T00:10:00Z'),
('d9800000-0000-4000-8000-000000000005','d9100000-0000-4000-8000-000000000001','d9700000-0000-4000-8000-000000000005','d9600000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','Responses',2,'{}','{}','staff-conflict-hash','d9500000-0000-4000-8000-000000000001','pending','2029-09-01T00:15:00Z');

CREATE TEMP TABLE noop_officer_result AS
SELECT plugin_data.csf_import_application_response_row_identity_base(
    'd9100000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
    'Casey','Nguyen',NULL,NULL,'casey','nguyen',NULL,NULL,
    'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001','d9800000-0000-4000-8000-000000000004',
    'changed-row-hash',
    jsonb_set((SELECT value FROM noop_application_data),'{courses,0,courseName}','"Advanced English"'),
    'd9000000-0000-4000-8000-000000000001') AS value;
SELECT extensions.is(
  (SELECT (value->>'canonicalWriteSkipped')::boolean FROM noop_officer_result),
  true,'an identical source snapshot preserves an assigned application');
SELECT extensions.is(
  (SELECT value->>'submissionStatus' FROM noop_officer_result),
  'decided','the unchanged import reports the preserved submission state');
SELECT extensions.is(
  (SELECT submission_status::text FROM plugin_data.csf_term_applications
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'),
  'decided','the unchanged import preserves the decided submission state');
SELECT extensions.is(
  (SELECT assigned_to FROM plugin_data.csf_term_applications
    WHERE organization_id='d9100000-0000-4000-8000-000000000001'),
  'd9000000-0000-4000-8000-000000000001'::uuid,
  'the unchanged import keeps the staff assignment');
SELECT extensions.throws_ok($$
  SELECT plugin_data.csf_import_application_response_row_identity_base(
    'd9100000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
    'Casey','Nguyen',NULL,NULL,'casey','nguyen',NULL,NULL,
    'd9300000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001',
    'd9600000-0000-4000-8000-000000000001','d9800000-0000-4000-8000-000000000005',
    'staff-conflict-hash',
    jsonb_set((SELECT value FROM noop_application_data),'{courses,0,courseName}','"Changed after assignment"'),
    'd9000000-0000-4000-8000-000000000001')
$$,'23514','A reviewed or officer-managed application already exists and was not overwritten.',
  'a changed source row still refuses to overwrite an assigned application');

SELECT * FROM extensions.finish();
ROLLBACK;
