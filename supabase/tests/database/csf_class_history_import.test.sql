BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(35);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_class_history_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot import CSF class history'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_class_history_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot import CSF class history'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_import_class_history_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role can import CSF class history'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot normalize imported CSF credit'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot normalize imported CSF credit'
);
SELECT extensions.ok(
  -- 20260730001004 revoked direct service access on purpose: the fenced wrapper
  -- plugin_data.csf_commit_import_row_for_attempt is the only reachable central
  -- import path. It is SECURITY DEFINER and owned, so it still calls this RPC, and
  -- the behavior assertions below still exercise it because pgTAP runs as the
  -- migration owner rather than as service_role.
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to normalize imported CSF credit directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_student_roster_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot import a CSF student roster'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_student_roster_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot import a CSF student roster'
);
SELECT extensions.ok(
  -- Revoked by 20260730001004 for the same reason as the class-history v2 RPC
  -- above: the fenced wrapper owns the only reachable central import path.
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_import_student_roster_row(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the server role cannot bypass the fenced wrapper to import a CSF student roster directly'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ce000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'csf-import-officer@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'CSF Class History Import',
  'csf-class-history-import',
  'school',
  '973001'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'S27',
  'Spring 2027',
  '2026-2027',
  'spring'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2028,
  'Class of 2028'
);

INSERT INTO plugin_data.csf_cohort_terms (
  id, organization_id, cohort_id, term_id, grade_level, sheet_tab_name
) VALUES (
  'ce400000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  11,
  'S27'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, cohort_id, source_type, title, provider, spreadsheet_id, settings
) VALUES
  (
    'ce500000-0000-4000-8000-000000000001',
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'class_history',
    'Class of 2028 workbook',
    'google_sheets',
    'fixture-spreadsheet',
    '{"sourceKind":"class_history"}'
  ),
  (
    'ce500000-0000-4000-8000-000000000002',
    'ce100000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'student_roster',
    'Class of 2028 roster',
    'google_sheets',
    'fixture-roster-spreadsheet',
    '{"sourceKind":"student_roster"}'
  );

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status
) VALUES
  (
    'ce600000-0000-4000-8000-000000000001',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000002',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000003',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000004',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000005',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000006',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  ),
  (
    'ce600000-0000-4000-8000-000000000007',
    'ce100000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000002',
    'ce000000-0000-4000-8000-000000000001',
    'preview',
    'completed'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name,
  school_email, normalized_school_email
) VALUES (
  'ce700000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'Manual',
  'Attendance',
  'manual',
  'attendance',
  'manual.attendance@students.local.test',
  'manual.attendance@students.local.test'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name,
  row_number, normalized_data, row_hash, matched_profile_id, import_status
) VALUES
  (
    'ce800000-0000-4000-8000-000000000001',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000001',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    2,
    '{"firstName":"Valid","lastName":"Import"}',
    'valid-row-hash',
    NULL,
    'pending'
  ),
  (
    'ce800000-0000-4000-8000-000000000002',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000002',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    3,
    '{"firstName":"Invalid","lastName":"Meeting"}',
    'invalid-meeting-hash',
    NULL,
    'pending'
  ),
  (
    'ce800000-0000-4000-8000-000000000003',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000003',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    4,
    '{"firstName":"Manual","lastName":"Attendance"}',
    'manual-attendance-hash',
    'ce700000-0000-4000-8000-000000000001',
    'pending'
  ),
  (
    'ce800000-0000-4000-8000-000000000004',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000004',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    5,
    '{"firstName":"Needs","lastName":"Review"}',
    'needs-review-hash',
    NULL,
    'ambiguous'
  ),
  (
    'ce800000-0000-4000-8000-000000000005',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000005',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    6,
    '{"firstName":"Changed","lastName":"Hash"}',
    'expected-row-hash',
    NULL,
    'pending'
  ),
  (
    'ce800000-0000-4000-8000-000000000006',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000006',
    'ce500000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'S27',
    7,
    '{"firstName":"Numeric","lastName":"Credit"}',
    'numeric-credit-hash',
    NULL,
    'pending'
  ),
  (
    'ce800000-0000-4000-8000-000000000007',
    'ce100000-0000-4000-8000-000000000001',
    'ce600000-0000-4000-8000-000000000007',
    'ce500000-0000-4000-8000-000000000002',
    'ce300000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'Roster',
    2,
    '{"firstName":"Roster","lastName":"Only"}',
    'roster-only-hash',
    NULL,
    'pending'
  );

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_jobs
    SET mapping_snapshot = '{"tampered":true}'
    WHERE id = 'ce600000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'CSF import provenance is immutable; create a retry job instead',
  'V46: a preview mapping snapshot cannot be rewritten'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_sheet_import_rows
    SET raw_data = '{"tampered":true}'
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF import row evidence is immutable; create a retry row instead.',
  'raw preview evidence cannot be rewritten'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row_v2(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Numeric',
      'Credit',
      'numeric.credit@students.local.test',
      NULL,
      'numeric',
      'credit',
      'numeric.credit@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000006',
      'numeric-credit-hash',
      '[{"slot":"activity_1","label":"Food Drive","value":"Food Drive","points":2,"sourceColumns":["Activity 1","Activity 2"]},{"slot":"activity_2","label":"Peer tutoring","value":"Peer tutoring","points":2.5,"sourceColumns":["Activity 3"]}]',
      '[]',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'numeric legacy activity credit is imported atomically'
);
SELECT extensions.is(
  (
    SELECT points::text
    FROM plugin_data.csf_credit_records
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND evidence @> '{"importRowId":"ce800000-0000-4000-8000-000000000006","slot":"activity_1"}'
  ),
  '2.00',
  'repeated legacy cells become one two-point award'
);
SELECT extensions.is(
  (
    SELECT points::text
    FROM plugin_data.csf_credit_records
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND evidence @> '{"importRowId":"ce800000-0000-4000-8000-000000000006","slot":"activity_2"}'
  ),
  '2.50',
  'an explicit decimal legacy value remains numeric'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_student_roster_row(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Roster',
      'Only',
      'roster.only@students.local.test',
      NULL,
      'roster',
      'only',
      'roster.only@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000002',
      'ce800000-0000-4000-8000-000000000007',
      'roster-only-hash',
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'a reviewed roster row creates a student record and class membership'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_memberships AS membership
    JOIN plugin_data.csf_profiles AS profile ON profile.id = membership.profile_id
    WHERE membership.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'roster.only@students.local.test'
  ),
  0,
  'a roster import does not manufacture a semester membership outcome'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Valid',
      'Import',
      'valid.import@students.local.test',
      'valid.import@personal.local.test',
      'valid',
      'import',
      'valid.import@students.local.test',
      'valid.import@personal.local.test',
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000001',
      'valid-row-hash',
      '[{"slot":"activity_1","label":"Activity 1","value":"Food Drive"},{"slot":"activity_2","label":"Activity 2","value":"Peer Tutoring"}]',
      '[{"key":"meeting_1","label":"September Meeting","value":"x","status":"attended"}]',
      true,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'a valid class-history row is imported atomically'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND normalized_school_email = 'valid.import@students.local.test'
  ),
  1,
  'the import creates one profile'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    JOIN plugin_data.csf_profiles AS profile ON profile.id = membership.profile_id
    WHERE membership.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND membership.cohort_id = 'ce300000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
      AND membership.status = 'active'
  ),
  1,
  'the import creates an active cohort membership'
);
SELECT extensions.is(
  (
    SELECT membership.status
    FROM plugin_data.csf_term_memberships AS membership
    JOIN plugin_data.csf_profiles AS profile ON profile.id = membership.profile_id
    WHERE membership.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND membership.term_id = 'ce200000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
  ),
  'completed',
  'the import creates the expected term membership'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_credit_records AS credit
    JOIN plugin_data.csf_profiles AS profile ON profile.id = credit.profile_id
    WHERE credit.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND credit.term_id = 'ce200000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
      AND credit.status = 'verified'
      AND credit.evidence @> '{"processor":"class_history_import"}'
  ),
  2,
  'the import creates one verified credit per activity'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profile_activity_events AS event
    JOIN plugin_data.csf_profiles AS profile ON profile.id = event.profile_id
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND event.term_id = 'ce200000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
      AND event.source_ref @> '{"processor":"class_history_import"}'
  ),
  2,
  'the import creates one activity event per activity'
);
SELECT extensions.is(
  (
    SELECT attendance.status || ':' || attendance.source
    FROM plugin_data.csf_meeting_attendance AS attendance
    JOIN plugin_data.csf_profiles AS profile ON profile.id = attendance.profile_id
    WHERE attendance.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND attendance.term_id = 'ce200000-0000-4000-8000-000000000001'
      AND attendance.meeting_key = 'meeting_1'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
  ),
  'attended:sheet',
  'the import creates confirmed Sheet attendance'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events AS event
    JOIN plugin_data.csf_profiles AS profile ON profile.id = event.target_id
    WHERE event.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND event.action = 'sheets.class_history_row_imported'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
  ),
  1,
  'the import records one audit event'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_term_applications AS application
    JOIN plugin_data.csf_profiles AS profile ON profile.id = application.profile_id
    WHERE application.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND profile.normalized_school_email = 'valid.import@students.local.test'
  ),
  0,
  'the class-history import does not create an application'
);
SELECT extensions.is(
  (
    SELECT import_status
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
  ),
  'created',
  'a new-profile import marks its row created'
);
SELECT extensions.ok(
  (
    SELECT matched_profile_id IS NOT NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'ce800000-0000-4000-8000-000000000001'
  ),
  'the created row is linked to the imported profile'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Invalid',
      'Meeting',
      'invalid.meeting@students.local.test',
      NULL,
      'invalid',
      'meeting',
      'invalid.meeting@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000002',
      'invalid-meeting-hash',
      '[{"slot":"activity_1","label":"Activity 1","value":"Should Roll Back"}]',
      '[{"key":"meeting_2","label":"October Meeting","value":"bad","status":"invalid"}]',
      false,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Invalid class-history attendance status.',
  'invalid attendance rejects the entire class-history row'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_profiles
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND normalized_school_email = 'invalid.meeting@students.local.test'
  ),
  0,
  'a failed import rolls back profile creation'
);
SELECT extensions.ok(
  (
    SELECT import_status = 'pending' AND matched_profile_id IS NULL
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'ce800000-0000-4000-8000-000000000002'
  ),
  'a failed import leaves its row pending and unmatched'
);

INSERT INTO plugin_data.csf_meeting_attendance (
  organization_id, profile_id, term_id, meeting_key, meeting_label, status,
  source, recorded_by, match_status, match_confidence, match_details
) VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce700000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'meeting_1',
  'September Meeting',
  'attended',
  'manual',
  'ce000000-0000-4000-8000-000000000001',
  'confirmed',
  1,
  '{"note":"officer correction"}'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row(
      'ce100000-0000-4000-8000-000000000001',
      'ce700000-0000-4000-8000-000000000001',
      'Manual',
      'Attendance',
      'manual.attendance@students.local.test',
      NULL,
      'manual',
      'attendance',
      'manual.attendance@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000003',
      'manual-attendance-hash',
      '[]',
      '[{"key":"meeting_1","label":"September Meeting","value":"missed","status":"missed"}]',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'a class-history import succeeds without replacing manual attendance'
);
SELECT extensions.is(
  (
    SELECT status || ':' || source
    FROM plugin_data.csf_meeting_attendance
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND profile_id = 'ce700000-0000-4000-8000-000000000001'
      AND term_id = 'ce200000-0000-4000-8000-000000000001'
      AND meeting_key = 'meeting_1'
  ),
  'attended:manual',
  'manual attendance remains authoritative'
);
SELECT extensions.is(
  (
    SELECT import_status
    FROM plugin_data.csf_sheet_import_rows
    WHERE id = 'ce800000-0000-4000-8000-000000000003'
  ),
  'updated',
  'an existing-profile import marks its row updated'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Needs',
      'Review',
      'needs.review@students.local.test',
      NULL,
      'needs',
      'review',
      'needs.review@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000004',
      'needs-review-hash',
      '[]',
      '[]',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The class-history row changed or still needs an officer decision.',
  'a row that still needs review cannot be imported'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_import_class_history_row(
      'ce100000-0000-4000-8000-000000000001',
      NULL,
      'Changed',
      'Hash',
      'changed.hash@students.local.test',
      NULL,
      'changed',
      'hash',
      'changed.hash@students.local.test',
      NULL,
      'ce300000-0000-4000-8000-000000000001',
      'ce200000-0000-4000-8000-000000000001',
      'ce500000-0000-4000-8000-000000000001',
      'ce800000-0000-4000-8000-000000000005',
      'different-row-hash',
      '[]',
      '[]',
      NULL,
      'ce000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The class-history row changed or still needs an officer decision.',
  'a changed row hash cannot be imported'
);

SELECT * FROM extensions.finish();

ROLLBACK;
