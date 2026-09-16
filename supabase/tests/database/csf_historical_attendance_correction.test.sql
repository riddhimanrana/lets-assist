-- 20260917110000: the three things it adds to csf_correct_meeting_attendance.
--
-- The existing csf_manual_attendance_corrections suite covers the correction
-- itself and stays the authority on that. This file covers only what is new:
-- the payload-bound replay, the closed-semester acknowledgement, and the source
-- reference with its notice suppression. It also asserts the 8-argument
-- entrypoint is unchanged, because every existing caller still uses it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(33);

-- ---------------------------------------------------------------------------
-- Both signatures exist, and only the reviewed role reaches either.
-- ---------------------------------------------------------------------------

SELECT extensions.has_function(
  'plugin_data', 'csf_correct_meeting_attendance',
  ARRAY['uuid','uuid','uuid','text','text','text','uuid','uuid'],
  'the original eight-argument entrypoint still exists'
);
SELECT extensions.has_function(
  'plugin_data', 'csf_correct_meeting_attendance',
  ARRAY['uuid','uuid','uuid','text','text','text','uuid','uuid','boolean','jsonb'],
  'the ten-argument entrypoint exists'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'the permission-checked server role can execute the ten-argument entrypoint'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'authenticated users cannot bypass the permission-checked Server Action'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'anonymous users cannot execute the ten-argument entrypoint'
);
-- The base holds the write and is reachable only through the wrapper that
-- rechecks authority under the staff-access lock.
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_correct_meeting_attendance_permission_base(uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'even the server role cannot call the base directly, so the lock cannot be skipped'
);
SELECT extensions.ok(
  has_function_privilege('postgres', 'plugin_data.csf_correct_meeting_attendance_permission_base(uuid,uuid,uuid,text,text,text,uuid,uuid,boolean,jsonb)', 'EXECUTE'),
  'the owner role holds the base grant explicitly rather than by default'
);

-- ---------------------------------------------------------------------------
-- Fixtures. Two semesters in one chapter: one open, one closed.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Payload-bound replay.
-- ---------------------------------------------------------------------------

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000001', 'set', 'excused',
    'Adviser approved the documented absence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000001',
    false, NULL
  ) $$,
  'an officer can correct attendance through the ten-argument entrypoint'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000001'),
  1,
  'the correction wrote exactly one audit event'
);

-- The whole point. The first call already happened; this is the retry.
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000001', 'set', 'excused',
    'Adviser approved the documented absence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000001',
    false, NULL
  ) $$,
  'replaying the identical request succeeds instead of writing again'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000001'),
  1,
  'the replay wrote no second audit event'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000001'),
  1,
  'the replay left one canonical attendance row'
);

-- Bound to the payload, not merely to the identifier. This is C7 one table over:
-- comparing the action and the actor alone let a reused id report success having
-- written a different change.
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000001', 'set', 'missed',
    'Adviser approved the documented absence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000001',
    false, NULL
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'reusing a request id for a different status is refused, not replayed'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'excused',
    'Adviser approved the documented absence.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000001',
    false, NULL
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'reusing a request id for a different member is refused'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000001', 'set', 'excused',
    'Adviser approved the documented absence.',
    'e1000000-0000-4000-8000-000000000002', 'e1500000-0000-4000-8000-000000000001',
    false, NULL
  ) $$,
  'P0001',
  'That request identifier is already bound to a different attendance correction.',
  'a second officer cannot replay the first officer''s request id'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000001'),
  'excused',
  'none of the refused retries changed the stored status'
);

-- A null correlation id keeps its old meaning: no replay key, so no receipt
-- lookup and no refusal. Two such calls are two corrections.
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'missed',
    'Officer confirmed this member did not attend.',
    'e1000000-0000-4000-8000-000000000001', NULL, false, NULL
  ) $$,
  'a correction with no request id still works, as it always did'
);

-- ---------------------------------------------------------------------------
-- Closed-semester scope.
-- ---------------------------------------------------------------------------

-- Closed the way the product closes a semester. Setting lifecycle_status
-- directly is refused by the close guard, and a fixture that disabled the
-- trigger would be testing a database this product never runs.
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

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Workbook shows this member attended the February meeting.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000010',
    false, NULL
  ) $$,
  'P0001',
  'This semester is closed. Confirm that you are correcting closed evidence before saving.',
  'a closed semester refuses a correction that does not acknowledge it'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance
   WHERE term_id = 'e1200000-0000-4000-8000-000000000002'),
  0,
  'the refused closed-semester correction wrote nothing'
);

-- The eight-argument entrypoint delegates with the acknowledgement false, so it
-- refuses a closed semester exactly as it did before this migration.
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Workbook shows this member attended the February meeting.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000011'
  ) $$,
  'P0001',
  'This semester is closed. Confirm that you are correcting closed evidence before saving.',
  'the original entrypoint is unchanged and still refuses closed evidence'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000002',
    'e1300000-0000-4000-8000-000000000001', 'set', 'attended',
    'Workbook shows this member attended the February meeting.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000012',
    true, NULL
  ) $$,
  'an acknowledged closed semester can be corrected'
);

SELECT extensions.is(
  (SELECT after_data ->> 'closedSemesterAcknowledged'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000012'),
  'true',
  'the acknowledgement is recorded on the receipt, not merely acted on'
);

-- An open semester records false, so the receipt distinguishes the two cases
-- rather than leaving the reader to infer it from the term.
SELECT extensions.is(
  (SELECT after_data ->> 'closedSemesterAcknowledged'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000001'),
  'false',
  'an open semester records the acknowledgement as false'
);

-- ---------------------------------------------------------------------------
-- Source evidence.
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'attended',
    'Workbook row says attended.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000020',
    false, '"not an object"'::jsonb
  ) $$,
  'P0001',
  'Attendance correction source evidence must be a JSON object.',
  'source evidence that is not an object is refused rather than stored'
);

-- Evidence has a shape. An open jsonb column becomes free text, and free text
-- beside a decision starts being read as the reason for it.
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'attended',
    'Workbook row says attended.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000022',
    false, '{"tabName":"S25","sheetRow":141}'::jsonb
  ) $$,
  'P0001',
  'Attendance correction source evidence must name its sourceId.',
  'source evidence that cannot name its workbook is refused'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'attended',
    'Workbook row says attended.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000023',
    false,
    '{"sourceId":"0c6863ab-4577-4836-9a48-a6fb9387885b","officerNote":"looks fine to me"}'::jsonb
  ) $$,
  'P0001',
  'Attendance correction source evidence may only name sourceId, tabName, sheetId, sheetRow and columnNumber.',
  'source evidence cannot smuggle a free-text note alongside the coordinate'
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001',
    'e1300000-0000-4000-8000-000000000002', 'set', 'attended',
    'Workbook row says attended.',
    'e1000000-0000-4000-8000-000000000001', 'e1500000-0000-4000-8000-000000000021',
    false,
    '{"sourceId":"0c6863ab-4577-4836-9a48-a6fb9387885b","tabName":"S25","sheetRow":141,"columnNumber":7}'::jsonb
  ) $$,
  'a correction can carry the workbook coordinate it came from'
);

SELECT extensions.is(
  (SELECT match_details -> 'sourceRef' ->> 'tabName'
   FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000002'
     AND term_id = 'e1200000-0000-4000-8000-000000000001'),
  'S25',
  'the source reference is stored on the attendance row as evidence'
);

-- Stored, never interpreted. The status is the officer's, and it is what they
-- passed; nothing here derived it from the cell the reference points at.
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_meeting_attendance
   WHERE profile_id = 'e1300000-0000-4000-8000-000000000002'
     AND term_id = 'e1200000-0000-4000-8000-000000000001'),
  'attended',
  'the stored status is the one the officer passed, not one derived from the source'
);

SELECT extensions.is(
  (SELECT after_data ->> 'noticesSuppressed'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000021'),
  'true',
  'a source reconciliation records that personal notices were suppressed'
);

-- A correction an officer makes on its own merits is not a bulk reconciliation
-- and still notifies.
SELECT extensions.is(
  (SELECT after_data ->> 'noticesSuppressed'
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'e1500000-0000-4000-8000-000000000001'),
  'false',
  'a correction with no source reference does not suppress notices'
);

SELECT extensions.finish();

ROLLBACK;
