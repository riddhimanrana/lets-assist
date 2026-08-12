BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(26);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_application_response_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot import CSF applications'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_application_response_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot import CSF applications'
);
-- 20260730001004 revoked direct service access to this row RPC on purpose: the
-- fenced wrapper plugin_data.csf_commit_import_row_for_attempt is the only
-- reachable central import path, and it is SECURITY DEFINER and owned, so it can
-- still call this function. The behavior assertions below continue to exercise the
-- RPC directly because pgTAP runs as the migration owner, not as service_role.
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_application_response_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to import a CSF application row directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'cf000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'application-import-officer@local.test',
    now(), '{}', '{}', now(), now()
  ),
  (
    'cf000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'inactive-application-import-officer@local.test',
    now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'CSF Application Import',
  'csf-application-import',
  'school',
  '995001'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  (
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'cf100000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000002',
    'admin', 'removed'
  );

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assert_import_actor(
      'cf100000-0000-4000-8000-000000000001',
      'cf000000-0000-4000-8000-000000000002',
      'application_responses'
    )
  $$,
  '42501',
  'This officer is not an active member of the organization whose CSF import they are acting on.',
  'an inactive officer cannot act through the application import boundary'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'S29', 'Spring 2029', '2028-2029', 'spring'
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, dues_required, dues_amount, dues_currency
) VALUES (
  'cf100000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  true, 5, 'USD'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  (
    'cf300000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    2030, 'Class of 2030'
  ),
  (
    'cf300000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    2029, 'Class of 2029'
  );

INSERT INTO plugin_data.csf_cohort_terms (
  id, organization_id, cohort_id, term_id, grade_level, sheet_tab_name
) VALUES
  (
    'cf400000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    11, 'Form Responses 1'
  ),
  (
    'cf400000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000002',
    'cf200000-0000-4000-8000-000000000001',
    12, 'Form Responses 1'
  );

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, cohort_id, source_type, target_strategy, title,
  provider, spreadsheet_id, drive_file_id, drive_file_name, sheet_url, settings
) VALUES
  (
    'cf500000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'application_responses', 'fixed', 'Spring 2029 application responses',
    'google_sheets', 'fixture-application-sheet', 'fixture-application-sheet',
    'Spring 2029 CSF Application Responses',
    'https://docs.google.com/spreadsheets/d/fixture-application-sheet/edit',
    '{"sourceKind":"application_responses","mappingVersion":1}'
  ),
  (
    'cf500000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    NULL, 'application_responses', 'derive_from_grade',
    'Spring 2029 mixed-grade application responses',
    'google_sheets', 'fixture-derived-application-sheet',
    'fixture-derived-application-sheet',
    'Spring 2029 Mixed Grade CSF Application Responses',
    'https://docs.google.com/spreadsheets/d/fixture-derived-application-sheet/edit',
    '{"sourceKind":"application_responses","targetStrategy":"derive_from_grade","mappingVersion":1}'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  mapping_snapshot, mapping_version
) VALUES
  (
    'cf600000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'application_responses',
    'fixture-application-sheet', 'Spring 2029 CSF Application Responses',
    'Form Responses 1', '''Form Responses 1''!A1:Z1000',
    '{"version":1,"sourceType":"application_responses"}', 1
  ),
  (
    'cf600000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'application_responses',
    'fixture-application-sheet', 'Spring 2029 CSF Application Responses',
    'Form Responses 1', '''Form Responses 1''!A1:Z1000',
    '{"version":1,"sourceType":"application_responses"}', 1
  ),
  (
    'cf600000-0000-4000-8000-000000000003',
    'cf100000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'application_responses',
    'fixture-application-sheet', 'Spring 2029 CSF Application Responses',
    'Form Responses 1', '''Form Responses 1''!A1:Z1000',
    '{"version":1,"sourceType":"application_responses"}', 1
  ),
  (
    'cf600000-0000-4000-8000-000000000004',
    'cf100000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000002',
    'cf000000-0000-4000-8000-000000000001',
    'preview', 'completed', 'application_responses',
    'fixture-derived-application-sheet',
    'Spring 2029 Mixed Grade CSF Application Responses',
    'Form Responses 1', '''Form Responses 1''!A1:Z1000',
    '{"version":1,"sourceType":"application_responses","targetStrategy":"derive_from_grade"}', 1
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, raw_data, normalized_data,
  row_hash, matched_profile_id, import_status
) VALUES
  (
    'cf700000-0000-4000-8000-000000000001',
    'cf100000-0000-4000-8000-000000000001',
    'cf600000-0000-4000-8000-000000000001',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'Form Responses 1', 2,
    '{"First Name":"Maya","Last Name":"Patel"}',
    '{"firstName":"Maya","lastName":"Patel"}',
    'application-row-hash-1', NULL, 'pending'
  ),
  (
    'cf700000-0000-4000-8000-000000000002',
    'cf100000-0000-4000-8000-000000000001',
    'cf600000-0000-4000-8000-000000000002',
    'cf500000-0000-4000-8000-000000000001',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'Form Responses 1', 3,
    '{"First Name":"Maya","Last Name":"Patel"}',
    '{"firstName":"Maya","lastName":"Patel"}',
    'application-row-hash-2', NULL, 'pending'
  ),
  (
    'cf700000-0000-4000-8000-000000000003',
    'cf100000-0000-4000-8000-000000000001',
    'cf600000-0000-4000-8000-000000000004',
    'cf500000-0000-4000-8000-000000000002',
    'cf300000-0000-4000-8000-000000000001',
    'cf200000-0000-4000-8000-000000000001',
    'Form Responses 1', 4,
    '{"First Name":"Leo","Last Name":"Martinez","Grade":11}',
    '{"firstName":"Leo","lastName":"Martinez","grade":11}',
    'derived-application-row-hash-1', NULL, 'pending'
  ),
  (
    'cf700000-0000-4000-8000-000000000004',
    'cf100000-0000-4000-8000-000000000001',
    'cf600000-0000-4000-8000-000000000004',
    'cf500000-0000-4000-8000-000000000002',
    'cf300000-0000-4000-8000-000000000002',
    'cf200000-0000-4000-8000-000000000001',
    'Form Responses 1', 5,
    '{"First Name":"Jordan","Last Name":"Lee","Grade":12}',
    '{"firstName":"Jordan","lastName":"Lee","grade":12}',
    'derived-application-row-hash-2', NULL, 'pending'
  );

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_application_response_row(
      'cf100000-0000-4000-8000-000000000001', NULL,
      'Maya', 'Patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'maya', 'patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000001',
      'cf700000-0000-4000-8000-000000000001',
      'application-row-hash-1',
      '{
        "sourceSubmittedAt":"2029-01-18T18:30:00Z",
        "currentGradeLevel":11,
        "returningStatus":"returning",
        "mostCheckedEmail":"maya.patel@example.test",
        "listIPoints":4,
        "listIAndIIPoints":7,
        "grandTotalPoints":11,
        "transcriptUrl":"https://drive.google.com/file/d/1TranscriptFixtureABC/view",
        "transcriptDriveFileId":"1TranscriptFixtureABC",
        "receiptUrl":"https://drive.google.com/open?id=1ReceiptFixtureXYZ",
        "receiptDriveFileId":"1ReceiptFixtureXYZ",
        "courses":[
          {"courseList":"I","courseName":"AP English Language","grade":"A","points":null,"isBonus":true,"rawLine":"AP English Language"},
          {"courseList":"II","courseName":"Spanish III","grade":"B+","points":null,"isBonus":false,"rawLine":"Spanish III"}
        ],
        "missingFields":[]
      }'::jsonb,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'a valid reviewed application preview commits atomically'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_profiles
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  1,
  'the application import creates one permanent student profile'
);
SELECT extensions.is(
  (SELECT submission_status::text FROM plugin_data.csf_term_applications
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  'ready',
  'complete imported information is ready for officer review'
);
SELECT extensions.is(
  (SELECT decision_status::text FROM plugin_data.csf_term_applications
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  'pending',
  'import never approves an application'
);
SELECT extensions.is(
  (SELECT eligibility_status::text FROM plugin_data.csf_term_applications
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  'pending',
  'import never decides academic eligibility'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_course_entries
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  2,
  'course lines are normalized into application course rows'
);
SELECT extensions.is(
  (SELECT status::text FROM plugin_data.csf_application_checks
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
     AND check_type = 'academic_eligibility'),
  'pending',
  'academic review remains pending after source import'
);
SELECT extensions.is(
  (SELECT status::text FROM plugin_data.csf_application_checks
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
     AND check_type = 'transcript'),
  'pending',
  'an imported transcript link still awaits officer verification'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_application_files
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
     AND provider = 'google_drive' AND verification_status = 'unreviewed'),
  2,
  'Drive transcript and receipt links stay private, unreviewed evidence'
);
SELECT extensions.is(
  (SELECT status::text FROM plugin_data.csf_dues_records
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  'receipt_submitted',
  'receipt import records submitted dues evidence without verifying payment'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'cf700000-0000-4000-8000-000000000001'),
  'created',
  'the immutable preview row records the application commit outcome'
);
SELECT extensions.ok(
  (SELECT matched_application_id IS NOT NULL AND matched_profile_id IS NOT NULL
   FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'cf700000-0000-4000-8000-000000000001'),
  'the import row links to the normalized profile and application'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_memberships
   WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
  0,
  'application import does not manufacture a semester membership outcome'
);
SELECT extensions.is(
  (
    SELECT (event.correlation_id = audit.correlation_id)::text
    FROM plugin_data.csf_application_status_events AS event
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.organization_id = event.organization_id
     AND audit.target_id = event.application_id
     AND audit.action = 'sheets.application_response_row_imported'
    WHERE event.organization_id = 'cf100000-0000-4000-8000-000000000001'
    ORDER BY event.created_at DESC, audit.created_at DESC
    LIMIT 1
  ),
  'true',
  'status history and immutable audit share one correlation ID'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_application_response_row(
      'cf100000-0000-4000-8000-000000000001', NULL,
      'Maya', 'Patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'maya', 'patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000001',
      'cf700000-0000-4000-8000-000000000001',
      'application-row-hash-1', '{}'::jsonb,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'The application row changed or still needs an officer decision.',
  'a committed immutable preview row cannot be replayed'
);

UPDATE plugin_data.csf_term_applications
SET submission_status = 'under_review'
WHERE organization_id = 'cf100000-0000-4000-8000-000000000001';

UPDATE plugin_data.csf_sheet_import_rows AS import_row
SET matched_profile_id = application.profile_id
FROM plugin_data.csf_term_applications AS application
WHERE import_row.id = 'cf700000-0000-4000-8000-000000000002'
  AND application.organization_id = import_row.organization_id;

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_application_response_row(
      'cf100000-0000-4000-8000-000000000001',
      (SELECT profile_id FROM plugin_data.csf_term_applications
       WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'),
      'Maya', 'Patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'maya', 'patel', 'maya.patel@students.local.test', 'maya.patel@example.test',
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000001',
      'cf700000-0000-4000-8000-000000000002',
      'application-row-hash-2',
      '{"currentGradeLevel":11,"mostCheckedEmail":"maya.patel@example.test","courses":[],"missingFields":["course_data"]}'::jsonb,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'A reviewed or officer-managed application already exists and was not overwritten.',
  'a later import cannot overwrite an application under officer review'
);
SELECT extensions.is(
  (SELECT import_status FROM plugin_data.csf_sheet_import_rows
   WHERE id = 'cf700000-0000-4000-8000-000000000002'),
  'pending',
  'the blocked refresh leaves its preview row unresolved'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND action = 'sheets.application_response_row_imported'
      AND source_type = 'sheet_import'
      AND source_id = 'cf500000-0000-4000-8000-000000000001'
  ),
  'the consequential application import records its source reference in immutable audit history'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_application_response_row(
      'cf100000-0000-4000-8000-000000000001', NULL,
      'Leo', 'Martinez', 'leo.martinez@students.local.test', NULL,
      'leo', 'martinez', 'leo.martinez@students.local.test', NULL,
      'cf300000-0000-4000-8000-000000000001',
      'cf200000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000002',
      'cf700000-0000-4000-8000-000000000003',
      'derived-application-row-hash-1',
      '{"currentGradeLevel":11,"mostCheckedEmail":"leo.martinez@students.local.test","courses":[],"missingFields":["transcript","receipt","course_data"]}'::jsonb,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'a grade-derived application row can commit into its resolved cohort'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_application_response_row(
      'cf100000-0000-4000-8000-000000000001', NULL,
      'Jordan', 'Lee', 'jordan.lee@students.local.test', NULL,
      'jordan', 'lee', 'jordan.lee@students.local.test', NULL,
      'cf300000-0000-4000-8000-000000000002',
      'cf200000-0000-4000-8000-000000000001',
      'cf500000-0000-4000-8000-000000000002',
      'cf700000-0000-4000-8000-000000000004',
      'derived-application-row-hash-2',
      '{"currentGradeLevel":12,"mostCheckedEmail":"jordan.lee@students.local.test","courses":[],"missingFields":["transcript","receipt","course_data"]}'::jsonb,
      'cf000000-0000-4000-8000-000000000001'
    )
  $$,
  'one mixed-grade preview can commit a sibling row into a different configured cohort'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_applications
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND source_import_job_id = 'cf600000-0000-4000-8000-000000000004'
  ),
  2,
  'the derived preview creates both normalized application records'
);

SELECT extensions.is(
  (
    SELECT count(DISTINCT cohort_id)::integer
    FROM plugin_data.csf_term_applications
    WHERE organization_id = 'cf100000-0000-4000-8000-000000000001'
      AND source_import_job_id = 'cf600000-0000-4000-8000-000000000004'
  ),
  2,
  'each derived row preserves its independently reviewed cohort target'
);

SELECT * FROM extensions.finish();

ROLLBACK;
