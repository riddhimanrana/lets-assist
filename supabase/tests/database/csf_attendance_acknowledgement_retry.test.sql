-- A replay must retain the officer's closed-semester acknowledgement.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'history-officer@local.test', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'history-officer-two@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('e1100000-0000-4000-8000-000000000001', 'CSF History One', 'csf-history-one', 'school', '994101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('e1100000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES
  ('e1200000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('e1200000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 'S25', 'Spring 2025', '2024-2025', 'spring', false);

-- The closed semester is closed through the audited close operation further
-- down, which needs a policy at the version it is closed at, a cohort, and at
-- least one active membership to snapshot. A direct UPDATE of lifecycle_status
-- is refused, and rightly so.
INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, required_meetings
) VALUES (
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000002',
  4, false, 7, 1
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'e1600000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  2028, 'Class of 2028'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('e1300000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'History', 'One', 'history', 'one'),
  ('e1300000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 'History', 'Two', 'history', 'two');

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status,
  status_reason, eligibility_snapshot
) VALUES (
  'e1700000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002',
  'e1600000-0000-4000-8000-000000000001', 'active', 'Current member.',
  '{"before":"active"}'::jsonb
);

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date, settings
) VALUES
  ('e1400000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'september', 'September meeting', '2030-09-12', '{}'::jsonb),
  -- The shape 20260829020011 mints for an imported meeting key.
  ('e1400000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000002', 'february_meeting', 'February Meeting', NULL, '{"recordOrigin":"class_history_import"}'::jsonb);

INSERT INTO plugin_data.csf_meeting_attendance (
  organization_id, profile_id, term_id, term_meeting_id, meeting_key,
  meeting_label, status, source, match_status, match_details
) VALUES
  ('e1100000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000001', 'e1200000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001', 'september', 'September meeting', 'attended', 'sheet', 'confirmed', '{"processor":"class_history_import"}'::jsonb),
  ('e1100000-0000-4000-8000-000000000001', 'e1300000-0000-4000-8000-000000000002', 'e1200000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001', 'september', 'September meeting', 'attended', 'sheet', 'confirmed', '{"processor":"class_history_import"}'::jsonb);

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_close_term_v2(
      'e1100000-0000-4000-8000-000000000001',
      'e1200000-0000-4000-8000-000000000002',
      4,
      plugin_data.csf_term_closure_readiness(
        'e1100000-0000-4000-8000-000000000001',
        'e1200000-0000-4000-8000-000000000002'
      )->>'evidenceHash',
      'e1000000-0000-4000-8000-000000000001'
    )
  $$,
  'the semester closes through the audited close operation'
);

SELECT extensions.is(
  (SELECT lifecycle_status FROM plugin_data.csf_terms
   WHERE id = 'e1200000-0000-4000-8000-000000000002'),
  'closed',
  'the fixture semester really is closed before the guard is exercised'
);

CREATE TEMP TABLE attendance_ack_receipt AS
SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Officer verified the historical attendance evidence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012',
    true, NULL
  ) AS result;

SELECT extensions.is(
  (SELECT result ->> 'closedSemesterAcknowledged' FROM attendance_ack_receipt),
  'true',
  'the original correction records the closed-semester acknowledgement'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Officer verified the historical attendance evidence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012',
    false, NULL
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'removing the acknowledgement cannot replay an acknowledged correction'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Officer verified the historical attendance evidence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012',
    NULL, NULL
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'a null acknowledgement cannot replay an acknowledged correction'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Officer verified the historical attendance evidence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012'
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'the legacy entrypoint cannot replay an acknowledged correction'
);

SELECT extensions.is(
  plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Officer verified the historical attendance evidence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012',
    true, NULL
  ),
  (SELECT result FROM attendance_ack_receipt),
  'the identical acknowledged retry returns the original receipt'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000012'),
  1,
  'refused retries and the exact replay add no audit event'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000001'
     AND term_id = 'e1200000-0000-4000-8000-000000000002'),
  'attended',
  'retries preserve the historical attendance correction'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000001'
     AND term_id = 'e1200000-0000-4000-8000-000000000002'),
  1,
  'retries preserve one canonical attendance row'
);
SELECT extensions.finish();
ROLLBACK;
