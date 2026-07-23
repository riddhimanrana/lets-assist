BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(27);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_close_term_v2(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot close a CSF semester'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_close_term_v2(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the server close action'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_close_term_v2(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'the server role can invoke the permission-checked close RPC'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_close_term(uuid,uuid,integer,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'the server role cannot call the legacy caller-authored decision RPC'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_trigger
    WHERE tgname IN (
      'csf_term_memberships_evidence_write_guard',
      'csf_credit_records_evidence_write_guard',
      'csf_meeting_attendance_evidence_write_guard',
      'csf_dues_records_evidence_write_guard',
      'csf_sheet_import_rows_evidence_write_guard',
      'csf_term_applications_evidence_write_guard',
      'csf_point_submissions_evidence_write_guard',
      'csf_point_appeals_evidence_write_guard',
      'csf_term_policies_evidence_write_guard',
      'csf_term_meetings_evidence_write_guard',
      'csf_meetings_evidence_write_guard',
      'csf_meeting_sessions_evidence_write_guard'
    )
      AND NOT tgisinternal
  ),
  12,
  'all term-close evidence tables share the database serialization guard'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'close-admin@local.test', now(), '{}', '{}', now(), now()),
  ('e7000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'close-outsider@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e7100000-0000-4000-8000-000000000001', 'CSF Close V2', 'csf-close-v2', 'school', '992701');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('e7100000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'e7200000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'S32', 'Spring 2032', '2031-2032', 'spring', 'open', true
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, max_drive_points, max_points_per_activity,
  required_meetings, allowed_absences
) VALUES (
  'e7100000-0000-4000-8000-000000000001',
  'e7200000-0000-4000-8000-000000000001',
  3, false, 7, 2, 3, 2, 1
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'e7300000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  2033, 'Class of 2033'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) VALUES
  ('e7400000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'Complete', 'Member', 'complete', 'member'),
  ('e7400000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', 'Incomplete', 'Member', 'incomplete', 'member');

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status
) VALUES
  ('e7500000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'active'),
  ('e7500000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'active');

INSERT INTO plugin_data.csf_credit_records (
  organization_id, profile_id, term_id, source, points, point_type,
  status, verified_by, verified_at
) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'manual', 4, 'non_drive', 'verified', 'e7000000-0000-4000-8000-000000000001', now()),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'manual', 3, 'non_drive', 'verified', 'e7000000-0000-4000-8000-000000000001', now()),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'manual', 1, 'non_drive', 'verified', 'e7000000-0000-4000-8000-000000000001', now()),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'manual', 2, 'non_drive', 'verified', 'e7000000-0000-4000-8000-000000000001', now());

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, required, status, sort_order
) VALUES
  ('e7900000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'meeting-1', 'Required meeting 1', true, 'active', 1),
  ('e7900000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'meeting-2', 'Required meeting 2', true, 'active', 2),
  ('e7900000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'optional-meeting', 'Optional meeting', false, 'active', 3),
  ('e7900000-0000-4000-8000-000000000004', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'cancelled-meeting', 'Cancelled required meeting', true, 'active', 4),
  ('e7900000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'inactive-meeting', 'Inactive required meeting', true, 'inactive', 5);

INSERT INTO plugin_data.csf_meetings (
  id, organization_id, term_id, meeting_key, label, required, status, sort_order
) VALUES
  ('e7910000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'meeting-1', 'Required meeting 1', true, 'active', 1),
  ('e7910000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'meeting-2', 'Required meeting 2', true, 'active', 2),
  ('e7910000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'optional-meeting', 'Optional meeting', false, 'active', 3),
  ('e7910000-0000-4000-8000-000000000004', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'cancelled-meeting', 'Cancelled required meeting', true, 'active', 4),
  ('e7910000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'inactive-meeting', 'Inactive required meeting', true, 'inactive', 5);

INSERT INTO plugin_data.csf_meeting_sessions (
  id, organization_id, meeting_id, legacy_term_meeting_id,
  session_date, location, status
) VALUES
  ('e7920000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000001', '2032-02-01', 'Room 1', 'closed'),
  ('e7920000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000002', 'e7900000-0000-4000-8000-000000000002', '2032-03-01', 'Room 2', 'closed'),
  ('e7920000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000003', 'e7900000-0000-4000-8000-000000000003', '2032-03-15', 'Room 3', 'closed'),
  ('e7920000-0000-4000-8000-000000000004', 'e7100000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000004', 'e7900000-0000-4000-8000-000000000004', '2032-04-01', 'Room 4', 'cancelled'),
  ('e7920000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000005', 'e7900000-0000-4000-8000-000000000005', '2032-04-15', 'Room 5', 'closed');

INSERT INTO plugin_data.csf_meeting_attendance (
  organization_id, profile_id, term_id, term_meeting_id, meeting_id,
  meeting_session_id, meeting_key, meeting_label, status, source, recorded_by
) VALUES
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000001', 'e7920000-0000-4000-8000-000000000001', 'meeting-1', 'Required meeting 1', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000002', 'e7910000-0000-4000-8000-000000000002', 'e7920000-0000-4000-8000-000000000002', 'meeting-2', 'Required meeting 2', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000003', 'e7910000-0000-4000-8000-000000000003', 'e7920000-0000-4000-8000-000000000003', 'optional-meeting', 'Optional meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000004', 'e7910000-0000-4000-8000-000000000004', 'e7920000-0000-4000-8000-000000000004', 'cancelled-meeting', 'Cancelled required meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000005', 'e7910000-0000-4000-8000-000000000005', 'e7920000-0000-4000-8000-000000000005', 'inactive-meeting', 'Inactive required meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000001', 'e7910000-0000-4000-8000-000000000001', 'e7920000-0000-4000-8000-000000000001', 'meeting-1', 'Required meeting 1', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000003', 'e7910000-0000-4000-8000-000000000003', 'e7920000-0000-4000-8000-000000000003', 'optional-meeting', 'Optional meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000004', 'e7910000-0000-4000-8000-000000000004', 'e7920000-0000-4000-8000-000000000004', 'cancelled-meeting', 'Cancelled required meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001'),
  ('e7100000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000001', 'e7900000-0000-4000-8000-000000000005', 'e7910000-0000-4000-8000-000000000005', 'e7920000-0000-4000-8000-000000000005', 'inactive-meeting', 'Inactive required meeting', 'attended', 'manual', 'e7000000-0000-4000-8000-000000000001');

SELECT extensions.ok(
  length(plugin_data.csf_term_closure_readiness(
    'e7100000-0000-4000-8000-000000000001',
    'e7200000-0000-4000-8000-000000000001'
  )->>'evidenceHash') = 64,
  'preflight returns a SHA-256 evidence revision'
);
SELECT extensions.is(
  (plugin_data.csf_term_closure_readiness(
    'e7100000-0000-4000-8000-000000000001',
    'e7200000-0000-4000-8000-000000000001'
  )->'counts'->>'imports')::integer,
  0,
  'preflight initially has no unresolved import rows'
);

CREATE TEMP TABLE csf_schedule_hash_before (hash text NOT NULL) ON COMMIT DROP;
INSERT INTO csf_schedule_hash_before (hash)
SELECT plugin_data.csf_term_closure_evidence_hash(
  'e7100000-0000-4000-8000-000000000001',
  'e7200000-0000-4000-8000-000000000001'
);

UPDATE plugin_data.csf_meeting_sessions
SET location = 'Updated optional meeting room'
WHERE id = 'e7920000-0000-4000-8000-000000000003';

SELECT extensions.ok(
  (SELECT hash FROM csf_schedule_hash_before) IS DISTINCT FROM
    plugin_data.csf_term_closure_evidence_hash(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001'
    ),
  'meeting schedule and session changes invalidate the close evidence hash'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, cohort_id, title, provider
) VALUES (
  'e7600000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000001',
  'Close blocker source', 'uploaded_csv'
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type
) VALUES (
  'e7700000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'e7600000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'preview', 'needs_resolution', 'class_history'
);
INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, term_id,
  sheet_tab_name, row_number, import_status, resolution_status
) VALUES (
  'e7800000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'e7700000-0000-4000-8000-000000000001',
  'e7600000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000001',
  'e7200000-0000-4000-8000-000000000001',
  'S32', 2, 'error', 'pending'
);

SELECT extensions.is(
  (plugin_data.csf_term_closure_readiness(
    'e7100000-0000-4000-8000-000000000001',
    'e7200000-0000-4000-8000-000000000001'
  )->'counts'->>'imports')::integer,
  1,
  'an unresolved term import appears in close preflight'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      3,
      plugin_data.csf_term_closure_readiness(
        'e7100000-0000-4000-8000-000000000001',
        'e7200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'e7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester cannot be closed while operational work remains.',
  'unresolved import evidence blocks close inside the transaction'
);

UPDATE plugin_data.csf_sheet_import_rows
SET resolution_status = 'ignored', resolution_reason_code = 'invalid_source',
    resolution_notes = 'Synthetic malformed row excluded from close.',
    resolved_by = 'e7000000-0000-4000-8000-000000000001', resolved_at = now()
WHERE id = 'e7800000-0000-4000-8000-000000000001';

SELECT extensions.ok(
  (plugin_data.csf_term_closure_readiness(
    'e7100000-0000-4000-8000-000000000001',
    'e7200000-0000-4000-8000-000000000001'
  )->>'ready')::boolean,
  'resolved import evidence clears the close blocker'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      3,
      repeat('0', 64),
      'e7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'Semester records changed after preflight; refresh and review the close checks again.',
  'a stale evidence revision is rejected'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      3,
      plugin_data.csf_term_closure_readiness(
        'e7100000-0000-4000-8000-000000000001',
        'e7200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'e7000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Not authorized to close this CSF semester.',
  'an outsider cannot close a semester through the server RPC'
);

CREATE TEMP TABLE csf_close_v2_result (payload jsonb NOT NULL) ON COMMIT DROP;
SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_close_v2_result (payload)
    SELECT plugin_data.csf_close_term_v2(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      3,
      plugin_data.csf_term_closure_readiness(
        'e7100000-0000-4000-8000-000000000001',
        'e7200000-0000-4000-8000-000000000001'
      )->>'evidenceHash',
      'e7000000-0000-4000-8000-000000000001'
    )
  $$,
  'the database derives and commits all membership outcomes atomically'
);

SELECT extensions.is(
  (SELECT payload->>'completed' FROM csf_close_v2_result),
  '1',
  'the close result reports one completed membership'
);
SELECT extensions.is(
  (SELECT payload->>'notCompleted' FROM csf_close_v2_result),
  '1',
  'the close result reports one incomplete membership'
);
SELECT extensions.is(
  (
    SELECT string_agg(outcome.derived_status, ',' ORDER BY outcome.profile_id)
    FROM plugin_data.csf_term_membership_outcomes AS outcome
    WHERE outcome.organization_id = 'e7100000-0000-4000-8000-000000000001'
      AND outcome.term_id = 'e7200000-0000-4000-8000-000000000001'
  ),
  'completed,not_completed',
  'stored outcomes come from database-side policy evaluation'
);
SELECT extensions.is(
  (
    SELECT string_agg(membership.status, ',' ORDER BY membership.profile_id)
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = 'e7100000-0000-4000-8000-000000000001'
      AND membership.term_id = 'e7200000-0000-4000-8000-000000000001'
  ),
  'completed,not_completed',
  'membership rows receive the derived frozen outcomes'
);
SELECT extensions.is(
  (
    SELECT string_agg(
      outcome.progress_snapshot->>'attendedMeetings',
      ',' ORDER BY outcome.profile_id
    )
    FROM plugin_data.csf_term_membership_outcomes AS outcome
    WHERE outcome.organization_id = 'e7100000-0000-4000-8000-000000000001'
      AND outcome.term_id = 'e7200000-0000-4000-8000-000000000001'
  ),
  '2,1',
  'only required active meetings with non-cancelled sessions count toward closeout'
);
SELECT extensions.ok(
  (
    SELECT closure.snapshot_version = 3
      AND length(closure.evidence_hash) = 64
      AND closure.evidence_hash = result.payload->>'evidenceHash'
    FROM plugin_data.csf_term_closures AS closure
    CROSS JOIN csf_close_v2_result AS result
    WHERE closure.id::text = result.payload->>'closureId'
  ),
  'the closure stores its exact versioned evidence hash'
);
SELECT extensions.ok(
  (
    SELECT term.lifecycle_status = 'closed'
      AND term.active_closure_id::text = result.payload->>'closureId'
    FROM plugin_data.csf_terms AS term
    CROSS JOIN csf_close_v2_result AS result
    WHERE term.id = 'e7200000-0000-4000-8000-000000000001'
  ),
  'the term atomically points at the new close revision'
);
SELECT extensions.throws_ok(
  $$
    INSERT INTO plugin_data.csf_credit_records (
      organization_id, profile_id, term_id, source, points, point_type, status
    ) VALUES (
      'e7100000-0000-4000-8000-000000000001',
      'e7400000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      'manual', 1, 'non_drive', 'verified'
    )
  $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'new evidence cannot be committed after semester close'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_meetings
    SET label = 'Changed after close'
    WHERE id = 'e7910000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'logical meeting requirements cannot change after semester close'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_meeting_sessions
    SET location = 'Changed after close'
    WHERE id = 'e7920000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'dated meeting sessions cannot change after semester close'
);
SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_term_meetings
    SET label = 'Changed after close'
    WHERE id = 'e7900000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'Closed CSF semester evidence is immutable; reopen the semester before making changes.',
  'legacy term meeting evidence cannot change after semester close'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events AS event
    CROSS JOIN csf_close_v2_result AS result
    WHERE event.organization_id = 'e7100000-0000-4000-8000-000000000001'
      AND event.action = 'term.close'
      AND event.correlation_id::text = result.payload->>'correlationId'
  ),
  1,
  'the outcome and immutable audit event share one correlation ID'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'e7100000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      3,
      (SELECT payload->>'evidenceHash' FROM csf_close_v2_result),
      'e7000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'CSF semester is missing, closed, or archived.',
  'a concurrent or repeated close cannot create a second active result'
);

SELECT * FROM extensions.finish();

ROLLBACK;
