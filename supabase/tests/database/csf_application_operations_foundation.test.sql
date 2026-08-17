BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(47);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot decide CSF applications'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_application_check(uuid,uuid,text,text,text,text,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot set application checks directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_set_application_dues(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot verify CSF dues directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_assign_application(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot assign CSF applications directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_add_application_private_note(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot add officer-only notes directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_decide_term_application(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass request-aware application decisions'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_application_check(uuid,uuid,text,text,text,text,jsonb,uuid,text)',
    'EXECUTE'
  ),
  'the server role can set application checks'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_set_application_dues(uuid,uuid,text,numeric,text,uuid)',
    'EXECUTE'
  ),
  'the server role can set application dues'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_assign_application(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can assign applications'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_add_application_private_note(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role can add private application notes'
);
SELECT extensions.ok(
  (
    SELECT bool_and(class.relrowsecurity)
    FROM pg_class AS class
    WHERE class.oid IN (
      'plugin_data.csf_application_checks'::regclass,
      'plugin_data.csf_dues_records'::regclass,
      'plugin_data.csf_application_private_notes'::regclass,
      'plugin_data.csf_term_deadlines'::regclass
    )
  )
  AND NOT has_table_privilege('authenticated', 'plugin_data.csf_application_checks', 'SELECT'),
  'new application operation tables keep the server-only RLS boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'ca000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'application-officer@local.test', now(), '{}', '{}', now(), now()
  ),
  (
    'ca000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'application-advisor@local.test', now(), '{}', '{}', now(), now()
  ),
  (
    'ca000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'application-outsider@local.test', now(), '{}', '{}', now(), now()
  ),
  (
    'ca000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'application-assignee@local.test', now(), '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'CSF Application Operations A',
    'csf-application-operations-a',
    'school',
    '984001'
  ),
  (
    'ca100000-0000-4000-8000-000000000002',
    'CSF Application Operations B',
    'csf-application-operations-b',
    'school',
    '984002'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'admin',
    'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000004',
    'staff',
    'active'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  (
    'ca200000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'F28', 'Fall 2028', '2028-2029', 'fall', true
  ),
  (
    'ca200000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000002',
    'F28', 'Fall 2028', '2028-2029', 'fall', true
  );

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, dues_required, dues_amount, dues_currency
) VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    true, 5, 'USD'
  ),
  (
    'ca100000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000002',
    true, 5, 'USD'
  );

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  (
    'ca300000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    2029, 'Class of 2029'
  ),
  (
    'ca300000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000002',
    2029, 'Class of 2029'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  (
    'ca400000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'Review', 'Student', 'review', 'student'
  ),
  (
    'ca400000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'Pending', 'Student', 'pending', 'student'
  ),
  (
    'ca400000-0000-4000-8000-000000000003',
    'ca100000-0000-4000-8000-000000000002',
    'Other', 'Tenant', 'other', 'tenant'
  );

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, role_type
) VALUES
  (
    'ca500000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'vice-president', 'Vice President', 'officer_template'
  ),
  (
    'ca500000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'advisor', 'Advisor', 'officer_template'
  );

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status
) VALUES
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000001',
    'ca500000-0000-4000-8000-000000000001',
    '2028-2029', 'Vice President', 'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000002',
    'ca500000-0000-4000-8000-000000000002',
    '2028-2029', 'Advisor', 'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000004',
    'ca500000-0000-4000-8000-000000000001',
    '2028-2029', 'Application Reviewer', 'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca000000-0000-4000-8000-000000000003',
    'ca500000-0000-4000-8000-000000000002',
    '2027-2028', 'Former Advisor', 'active'
  );

INSERT INTO plugin_data.csf_term_applications (
  id,
  organization_id,
  profile_id,
  cohort_id,
  term_id,
  source,
  status,
  submission_status,
  current_grade_level,
  most_checked_email
) VALUES (
  'ca600000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'google_form_sheet',
  'submitted',
  'ready',
  11,
  'review.student@local.test'
);

INSERT INTO plugin_data.csf_application_course_entries (
  organization_id, application_id, course_list, course_name, grade, points
) VALUES (
  'ca100000-0000-4000-8000-000000000001',
  'ca600000-0000-4000-8000-000000000001',
  'I', 'Synthetic adviser-review course', 'A', 3
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_application_checks
    WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'
      AND application_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  6,
  'every new application receives the complete normalized check set'
);
SELECT extensions.is(
  (
    SELECT status::text
    FROM plugin_data.csf_dues_records
    WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'
      AND application_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'not_recorded',
  'a required term starts a new application with unrecorded dues'
);

-- Checks no longer gate the decision; the officer decides from the imported
-- row. A rejection without notes is still refused, and a refused decision
-- still leaves zero partial state behind.
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_decide_term_application(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'rejected',
      NULL,
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Review notes are required for this decision.',
  'a rejection cannot be recorded without review notes'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  0,
  'a rejected atomic decision leaves no partial audit history'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'required_information', 'passed', 'complete', 'Required fields present.', '{}',
      'ca000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  'an officer can complete the required-information check atomically'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'transcript', 'passed', 'document_verified', 'Transcript verified.', '{}',
      'ca000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  'an officer can complete the transcript check atomically'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'course_data', 'passed', 'courses_verified', 'Courses verified.', '{}',
      'ca000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  'an officer can complete the course-data check atomically'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'academic_eligibility', 'failed', 'below_threshold', 'Academic threshold not met.', '{}',
      'ca000000-0000-4000-8000-000000000001', NULL
    )
  $$,
  'an officer can record a failed academic eligibility check'
);
SELECT extensions.is(
  (
    SELECT eligibility_status::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'ineligible',
  'the normalized academic check synchronizes application eligibility'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'academic_eligibility', 'waived', 'officer_override', 'Officer override.', '{}',
      'ca000000-0000-4000-8000-000000000001', 'Attempted officer exception'
    )
  $$,
  'P0001',
  'Academic eligibility may only be overridden by a CSF adviser.',
  'a non-adviser cannot waive academic eligibility'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'academic_eligibility', 'waived', 'former_adviser_override', 'Former adviser override.', '{}',
      'ca000000-0000-4000-8000-000000000003', 'Attempted prior-year adviser exception'
    )
  $$,
  'P0001',
  'Academic eligibility may only be overridden by a CSF adviser.',
  'a prior-year adviser cannot waive current academic eligibility'
);
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_check(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'academic_eligibility', 'waived', 'adviser_override', 'Advisor exception approved.', '{}',
      'ca000000-0000-4000-8000-000000000002', 'Documented adviser exception'
    )
  $$,
  'an active CSF adviser can waive academic eligibility with a reason'
);
SELECT extensions.is(
  (
    SELECT eligibility_status::text
    FROM plugin_data.csf_term_applications
    WHERE id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'adviser_override',
  'an adviser waiver is represented separately from ordinary eligibility'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_set_application_dues(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'verified', 5, NULL,
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can verify dues atomically'
);
SELECT extensions.is(
  (
    SELECT status::text
    FROM plugin_data.csf_application_checks
    WHERE application_id = 'ca600000-0000-4000-8000-000000000001'
      AND check_type = 'dues'
  ),
  'passed',
  'dues verification synchronizes the mandatory dues check'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_assign_application(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'ca000000-0000-4000-8000-000000000004',
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'an application can be assigned to active CSF staff atomically'
);
SELECT extensions.is(
  (
    SELECT assigned_to
    FROM plugin_data.csf_term_applications
    WHERE id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'ca000000-0000-4000-8000-000000000004'::uuid,
  'the application stores its current staff assignee'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_assign_application(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'ca000000-0000-4000-8000-000000000003',
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The assignee is not active CSF staff for this organization.',
  'an application cannot be assigned to an unrelated account'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_add_application_private_note(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'Sensitive internal note',
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'an officer can add a private application note atomically'
);
SELECT extensions.is(
  (
    SELECT body
    FROM plugin_data.csf_application_private_notes
    WHERE application_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'Sensitive internal note',
  'private note content is stored in the server-only note table'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'ca600000-0000-4000-8000-000000000001'
      AND action = 'application.private_note.add'
      AND after_data::text LIKE '%Sensitive internal note%'
  ),
  'audit metadata does not duplicate private note content'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_decide_term_application(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'accepted',
      'Adviser exception documented.',
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'a fully reviewed application is decided atomically'
);
SELECT extensions.ok(
  (
    SELECT status = 'accepted'
      AND submission_status = 'decided'
      AND decision_status = 'approved'
      AND decision_reason_code = 'approved_adviser_override'
    FROM plugin_data.csf_term_applications
    WHERE id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'the atomic decision synchronizes legacy and normalized application states'
);
SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_term_memberships
    WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'
      AND application_id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'accepted',
  'the application decision creates the matching term membership'
);
SELECT extensions.ok(
  (
    SELECT application.decision_correlation_id = event.correlation_id
      AND event.correlation_id = audit.correlation_id
    FROM plugin_data.csf_term_applications AS application
    JOIN plugin_data.csf_application_status_events AS event
      ON event.application_id = application.id
     AND event.next_status = 'accepted'
    JOIN plugin_data.csf_admin_audit_events AS audit
      ON audit.target_id = application.id
     AND audit.action = 'application.accepted'
    WHERE application.id = 'ca600000-0000-4000-8000-000000000001'
  ),
  'application, status history, and audit history share one correlation ID'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET reason_code = 'tampered'
    WHERE target_id = 'ca600000-0000-4000-8000-000000000001'
      AND action = 'application.accepted'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'CSF audit history cannot be updated'
);
SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'ca600000-0000-4000-8000-000000000001'
      AND action = 'application.accepted'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'CSF audit history cannot be deleted'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_application_checks (
      organization_id, application_id, check_type, status
    ) VALUES (
      'ca100000-0000-4000-8000-000000000002',
      'ca600000-0000-4000-8000-000000000001',
      'identity', 'pending'
    )
  $$,
  '23503',
  'insert or update on table "csf_application_checks" violates foreign key constraint "csf_application_checks_application_organization_fkey"',
  'tenant-aware application checks reject a cross-organization application'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_term_deadlines (
      organization_id, term_id, deadline_type, title, due_at
    ) VALUES (
      'ca100000-0000-4000-8000-000000000002',
      'ca200000-0000-4000-8000-000000000001',
      'points', 'Cross-tenant deadline', now()
    )
  $$,
  '23503',
  'insert or update on table "csf_term_deadlines" violates foreign key constraint "csf_term_deadlines_term_organization_fkey"',
  'tenant-aware deadlines reject a cross-organization term'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO plugin_data.csf_application_files (
      organization_id,
      application_id,
      profile_id,
      term_id,
      file_type,
      bucket,
      object_path,
      provider,
      drive_file_id,
      drive_file_name,
      source_url
    ) VALUES (
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000001',
      'ca400000-0000-4000-8000-000000000001',
      'ca200000-0000-4000-8000-000000000001',
      'transcript', NULL, NULL, 'google_drive',
      'drive-fixture-id', 'Transcript.pdf', 'https://drive.google.com/file/d/drive-fixture-id'
    )
  $$,
  'application evidence can retain Google Drive provenance without copying the file'
);
SELECT extensions.is(
  (
    SELECT provider
    FROM plugin_data.csf_application_files
    WHERE drive_file_id = 'drive-fixture-id'
  ),
  'google_drive',
  'the evidence record identifies Google Drive as its provider'
);

INSERT INTO plugin_data.csf_term_applications (
  id,
  organization_id,
  profile_id,
  cohort_id,
  term_id,
  source,
  status,
  current_grade_level,
  most_checked_email
) VALUES (
  'ca600000-0000-4000-8000-000000000002',
  'ca100000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000002',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'google_form_sheet',
  'submitted',
  11,
  'pending.student@local.test'
);

UPDATE plugin_data.csf_application_checks
SET
  status = 'passed',
  reviewed_by = 'ca000000-0000-4000-8000-000000000001',
  reviewed_at = now()
WHERE organization_id = 'ca100000-0000-4000-8000-000000000001'
  AND application_id = 'ca600000-0000-4000-8000-000000000002'
  AND check_type <> 'dues';

-- Dues no longer gate the decision: an officer can accept straight from the
-- imported row, and the membership transition happens in the same transaction.
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_decide_term_application(
      'ca100000-0000-4000-8000-000000000001',
      'ca600000-0000-4000-8000-000000000002',
      'accepted', NULL,
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'unresolved dues do not block an application decision'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships
    WHERE application_id = 'ca600000-0000-4000-8000-000000000002'
  ),
  1,
  'the relaxed decision still creates the matching term membership'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_sheet_import_jobs'
      AND column_name = 'mapping_snapshot'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_sheet_import_rows'
      AND column_name = 'resolution_status'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_term_applications'
      AND column_name = 'source_import_row_id'
  ),
  'imports preserve mapping, reconciliation, retry, and application provenance fields'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_term_deadlines'
      AND column_name = 'audience'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'plugin_data'
      AND table_name = 'csf_term_deadlines'
      AND column_name = 'related_route'
  ),
  'term deadlines include an actionable audience and destination'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_set_application_dues(
      'ca100000-0000-4000-8000-000000000002',
      'ca600000-0000-4000-8000-000000000001',
      'verified', 5, NULL,
      'ca000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF application not found.',
  'dues RPCs cannot cross the application organization boundary'
);

SELECT * FROM extensions.finish();

ROLLBACK;
