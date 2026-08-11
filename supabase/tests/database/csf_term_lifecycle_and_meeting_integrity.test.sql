BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(29);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_trigger
    WHERE tgrelid = 'plugin_data.csf_terms'::regclass
      AND tgname = 'csf_terms_lifecycle_write_guard'
      AND NOT tgisinternal
  ),
  1,
  'CSF semesters have one database lifecycle guard'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE convalidated
      AND conname IN (
        'csf_terms_organization_id_id_key',
        'csf_meetings_organization_id_key',
        'csf_meetings_organization_term_id_key',
        'csf_meetings_term_organization_fkey',
        'csf_term_meetings_organization_id_key',
        'csf_term_meetings_organization_term_id_key',
        'csf_term_meetings_term_organization_fkey',
        'csf_meeting_sessions_organization_meeting_id_key',
        'csf_meeting_sessions_meeting_organization_fkey',
        'csf_meeting_sessions_legacy_organization_fkey',
        'csf_meeting_attendance_profile_organization_fkey',
        'csf_meeting_attendance_term_organization_fkey',
        'csf_meeting_attendance_meeting_term_organization_fkey',
        'csf_meeting_attendance_legacy_term_organization_fkey',
        'csf_meeting_attendance_session_meeting_organization_fkey',
        'csf_meeting_attendance_session_requires_meeting_check'
      )
  ),
  16,
  'all organization-scoped meeting and attendance constraints are present and validated'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ef000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'term-integrity-admin@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ef100000-0000-4000-8000-000000000001', 'CSF Term Integrity A', 'csf-term-integrity-a', 'school', '997001'),
  ('ef100000-0000-4000-8000-000000000002', 'CSF Term Integrity B', 'csf-term-integrity-b', 'school', '997002');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES
  ('ef200000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'S34', 'Spring 2034', '2033-2034', 'spring', 'open', true),
  ('ef200000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 'F33', 'Fall 2033', '2033-2034', 'fall', 'planned', false),
  ('ef200000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000002', 'S34', 'Spring 2034', '2033-2034', 'spring', 'open', true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
      AND lifecycle_status = 'open'
  ),
  'normal open-semester inserts remain available'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_terms (
      organization_id, code, label, school_year, semester, lifecycle_status
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'F32', 'Fabricated closed semester', '2032-2033', 'fall', 'closed'
    )
  $$,
  'P0001',
  'Closed or archived CSF semesters cannot be inserted directly.',
  'a closed semester cannot be fabricated with a direct insert'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET lifecycle_status = 'closed'
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'CSF semesters must be closed through the audited close operation.',
  'an open semester cannot be closed with a direct update'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET lifecycle_status = 'archived'
    WHERE id = 'ef200000-0000-4000-8000-000000000002'
  $$,
  'P0001',
  'CSF semesters must be archived through an audited lifecycle operation.',
  'a planned semester cannot be archived with a direct update'
);

-- Construct a historical archive fixture as the database owner. Runtime
-- callers cannot switch the replication role, and the assertions below
-- exercise the guard after the row is in its historical state. A transaction-
-- local role avoids ALTER TABLE failing when pgTAP already has pending trigger
-- events in this test transaction.
SET LOCAL session_replication_role = replica;
UPDATE plugin_data.csf_terms
SET lifecycle_status = 'archived'
WHERE id = 'ef200000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role = origin;

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, max_drive_points, max_points_per_activity,
  required_meetings, allowed_absences
) VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001',
  1, false, 0, 0, 3, 0, 0
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'ef300000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  2035, 'Class of 2035'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('ef400000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'Tenant', 'Alpha', 'tenant', 'alpha'),
  ('ef400000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000002', 'Tenant', 'Beta', 'tenant', 'beta');

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status
) VALUES (
  'ef500000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'ef400000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001',
  'ef300000-0000-4000-8000-000000000001',
  'active'
);

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, required, status, sort_order
) VALUES
  ('ef600000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'meeting-a1', 'Meeting A1', true, 'active', 1),
  ('ef600000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'meeting-a2', 'Meeting A2', true, 'active', 2),
  ('ef600000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000002', 'ef200000-0000-4000-8000-000000000003', 'meeting-b1', 'Meeting B1', true, 'active', 1),
  ('ef600000-0000-4000-8000-000000000004', 'ef100000-0000-4000-8000-000000000002', 'ef200000-0000-4000-8000-000000000003', 'meeting-b2', 'Meeting B2', true, 'active', 2);

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, required, status, sort_order
) VALUES
  ('ef610000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'meeting-a1', 'Meeting A1', true, 'active', 1),
  ('ef610000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001', 'meeting-a2', 'Meeting A2', true, 'active', 2),
  ('ef610000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000002', 'ef200000-0000-4000-8000-000000000003', 'meeting-b1', 'Meeting B1', true, 'active', 1);

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id, session_date, status
) VALUES
  ('ef620000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000001', 'ef610000-0000-4000-8000-000000000001', 'ef600000-0000-4000-8000-000000000001', '2034-02-01', 'closed'),
  ('ef620000-0000-4000-8000-000000000002', 'ef100000-0000-4000-8000-000000000001', 'ef610000-0000-4000-8000-000000000002', 'ef600000-0000-4000-8000-000000000002', '2034-03-01', 'closed'),
  ('ef620000-0000-4000-8000-000000000003', 'ef100000-0000-4000-8000-000000000002', 'ef610000-0000-4000-8000-000000000003', 'ef600000-0000-4000-8000-000000000003', '2034-02-01', 'closed');

INSERT INTO plugin_data.csf_meeting_attendance (
  id, organization_id, profile_id, term_id, term_meeting_id, meeting_id,
  meeting_session_id, meeting_key, meeting_label, status, source
) VALUES (
  'ef700000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'ef400000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001',
  'ef600000-0000-4000-8000-000000000001',
  'ef610000-0000-4000-8000-000000000001',
  'ef620000-0000-4000-8000-000000000001',
  'meeting-a1', 'Meeting A1', 'attended', 'manual'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET label = 'Spring 2034 operations'
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'ordinary open-semester edits remain available'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meetings (
      organization_id, term_id, meeting_key, label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000003',
      'cross-term', 'Cross-tenant term'
    )
  $$,
  'P0001',
  'The CSF semester for this operational record no longer exists.',
  'a logical meeting cannot reference another organization semester'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_sessions (
      organization_id, meeting_id, session_date
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef610000-0000-4000-8000-000000000003',
      '2034-04-01'
    )
  $$,
  'P0001',
  'The parent CSF meeting for this session no longer exists.',
  'a session cannot reference another organization logical meeting'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_sessions (
      organization_id, meeting_id, legacy_term_meeting_id, session_date
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef610000-0000-4000-8000-000000000001',
      'ef600000-0000-4000-8000-000000000004',
      '2034-04-01'
    )
  $$,
  '23503',
  'insert or update on table "csf_meeting_sessions" violates foreign key constraint "csf_meeting_sessions_legacy_organization_fkey"',
  'a session cannot reference another organization legacy meeting'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, meeting_key, meeting_label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000002',
      'ef200000-0000-4000-8000-000000000001',
      'cross-profile', 'Cross-tenant profile'
    )
  $$,
  '23503',
  'insert or update on table "csf_meeting_attendance" violates foreign key constraint "csf_meeting_attendance_profile_organization_fkey"',
  'attendance cannot attach another organization profile'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, meeting_key, meeting_label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000003',
      'cross-semester', 'Cross-tenant semester'
    )
  $$,
  'P0001',
  'The CSF semester for this operational record no longer exists.',
  'attendance cannot attach another organization semester'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, meeting_id,
      meeting_key, meeting_label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      'ef610000-0000-4000-8000-000000000003',
      'cross-meeting', 'Cross-tenant meeting'
    )
  $$,
  '23503',
  'insert or update on table "csf_meeting_attendance" violates foreign key constraint "csf_meeting_attendance_meeting_term_organization_fkey"',
  'attendance cannot attach another organization logical meeting'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, meeting_id, meeting_session_id,
      meeting_key, meeting_label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      'ef610000-0000-4000-8000-000000000001',
      'ef620000-0000-4000-8000-000000000002',
      'cross-session', 'Mismatched session'
    )
  $$,
  '23503',
  'insert or update on table "csf_meeting_attendance" violates foreign key constraint "csf_meeting_attendance_session_meeting_organization_fkey"',
  'attendance sessions must belong to the selected logical meeting'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, meeting_session_id,
      meeting_key, meeting_label
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'ef400000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      'ef620000-0000-4000-8000-000000000001',
      'missing-meeting', 'Missing meeting'
    )
  $$,
  '23514',
  'new row for relation "csf_meeting_attendance" violates check constraint "csf_meeting_attendance_session_requires_meeting_check"',
  'a dated session link requires its logical meeting link'
);

CREATE TEMP TABLE csf_integrity_hashes (
  stage text PRIMARY KEY,
  evidence_hash text NOT NULL
) ON COMMIT DROP;

INSERT INTO csf_integrity_hashes
VALUES (
  'initial',
  plugin_data.csf_term_closure_evidence_hash(
    'ef100000-0000-4000-8000-000000000001',
    'ef200000-0000-4000-8000-000000000001'
  )
);

UPDATE plugin_data.csf_meeting_attendance
SET meeting_session_id = NULL
WHERE id = 'ef700000-0000-4000-8000-000000000001';
INSERT INTO csf_integrity_hashes
VALUES ('without-session', plugin_data.csf_term_closure_evidence_hash('ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001'));
SELECT extensions.ok(
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'initial')
    IS DISTINCT FROM
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'without-session'),
  'meeting_session_id participates in the close evidence hash'
);

UPDATE plugin_data.csf_meeting_attendance
SET meeting_id = 'ef610000-0000-4000-8000-000000000002'
WHERE id = 'ef700000-0000-4000-8000-000000000001';
INSERT INTO csf_integrity_hashes
VALUES ('second-meeting', plugin_data.csf_term_closure_evidence_hash('ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001'));
SELECT extensions.ok(
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'without-session')
    IS DISTINCT FROM
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'second-meeting'),
  'meeting_id participates in the close evidence hash'
);

UPDATE plugin_data.csf_meeting_attendance
SET term_meeting_id = 'ef600000-0000-4000-8000-000000000002'
WHERE id = 'ef700000-0000-4000-8000-000000000001';
INSERT INTO csf_integrity_hashes
VALUES ('second-legacy-meeting', plugin_data.csf_term_closure_evidence_hash('ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001'));
SELECT extensions.ok(
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'second-meeting')
    IS DISTINCT FROM
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'second-legacy-meeting'),
  'term_meeting_id participates in the close evidence hash'
);

UPDATE plugin_data.csf_meeting_attendance
SET meeting_session_id = 'ef620000-0000-4000-8000-000000000002'
WHERE id = 'ef700000-0000-4000-8000-000000000001';
INSERT INTO csf_integrity_hashes
VALUES ('restored-session', plugin_data.csf_term_closure_evidence_hash('ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001'));
SELECT extensions.ok(
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'second-legacy-meeting')
    IS DISTINCT FROM
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'restored-session'),
  'restoring a compatible dated-session link changes the close evidence hash'
);

UPDATE plugin_data.csf_meeting_attendance
SET source = 'sheet', source_row_id = 'ef710000-0000-4000-8000-000000000001'
WHERE id = 'ef700000-0000-4000-8000-000000000001';
INSERT INTO csf_integrity_hashes
VALUES ('source-linked', plugin_data.csf_term_closure_evidence_hash('ef100000-0000-4000-8000-000000000001', 'ef200000-0000-4000-8000-000000000001'));
SELECT extensions.ok(
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'restored-session')
    IS DISTINCT FROM
  (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'source-linked'),
  'attendance source and source-row linkage participate in the close evidence hash'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'ef100000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      1,
      (SELECT evidence_hash FROM csf_integrity_hashes WHERE stage = 'restored-session'),
      'ef000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Semester records changed after preflight; refresh and review the close checks again.',
  'source-link changes make an already-reviewed close hash stale'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'ef100000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      1,
      plugin_data.csf_term_closure_evidence_hash(
        'ef100000-0000-4000-8000-000000000001',
        'ef200000-0000-4000-8000-000000000001'
      ),
      'ef000000-0000-4000-8000-000000000001'
    )
  $$,
  'the audited close RPC can still finalize a semester'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET label = 'Tampered closed term'
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed or archived CSF semester records are immutable; use the audited reopen operation.',
  'closed semester metadata cannot be edited directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET lifecycle_status = 'open', active_closure_id = NULL,
        closed_at = NULL, closed_by = NULL, closure_policy_version = NULL
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed or archived CSF semester records are immutable; use the audited reopen operation.',
  'a direct semester reopen cannot bypass the authorized wrapper'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_terms
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed or archived CSF semester records are immutable.',
  'a closed semester cannot be deleted directly'
);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      'ef100000-0000-4000-8000-000000000001',
      'ef200000-0000-4000-8000-000000000001',
      (SELECT active_closure_id FROM plugin_data.csf_terms WHERE id = 'ef200000-0000-4000-8000-000000000001'),
      (SELECT closure_revision FROM plugin_data.csf_terms WHERE id = 'ef200000-0000-4000-8000-000000000001'),
      'data_correction',
      'Reopen the synthetic semester to correct its source-linked attendance.',
      'ef000000-0000-4000-8000-000000000001',
      'ef800000-0000-4000-8000-000000000001'
    )
  $$,
  'the authorized audited reopen wrapper remains functional'
);

SELECT extensions.lives_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET label = 'Spring 2034 corrected'
    WHERE id = 'ef200000-0000-4000-8000-000000000001'
  $$,
  'ordinary semester edits resume after an authorized reopen'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_terms
    SET label = 'Tampered archive'
    WHERE id = 'ef200000-0000-4000-8000-000000000002'
  $$,
  'P0001',
  'Closed or archived CSF semester records are immutable; use the audited reopen operation.',
  'archived semester metadata cannot be edited directly'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM plugin_data.csf_terms
    WHERE id = 'ef200000-0000-4000-8000-000000000002'
  $$,
  'P0001',
  'Closed or archived CSF semester records are immutable.',
  'an archived semester cannot be deleted directly'
);

SELECT * FROM extensions.finish();

ROLLBACK;
