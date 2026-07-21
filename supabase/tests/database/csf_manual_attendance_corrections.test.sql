BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot execute manual attendance corrections'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)', 'EXECUTE'),
  'anonymous users cannot execute manual attendance corrections'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot bypass the permission-checked Server Action'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_correct_meeting_attendance(uuid,uuid,uuid,text,text,text,uuid,uuid)', 'EXECUTE'),
  'the permission-checked server role can execute manual attendance corrections'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attendance-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d3100000-0000-4000-8000-000000000001', 'CSF Attendance One', 'csf-attendance-one', 'school', '993101'),
  ('d3100000-0000-4000-8000-000000000002', 'CSF Attendance Two', 'csf-attendance-two', 'school', '993102');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
VALUES
  ('d3200000-0000-4000-8000-000000000001', 'd3100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('d3200000-0000-4000-8000-000000000002', 'd3100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('d3300000-0000-4000-8000-000000000001', 'd3100000-0000-4000-8000-000000000001', 'Attendance', 'One', 'attendance', 'one'),
  ('d3300000-0000-4000-8000-000000000002', 'd3100000-0000-4000-8000-000000000001', 'Attendance', 'Two', 'attendance', 'two'),
  ('d3300000-0000-4000-8000-000000000003', 'd3100000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant');

INSERT INTO plugin_data.csf_term_meetings (
  id, organization_id, term_id, meeting_key, label, meeting_date
) VALUES
  ('d3400000-0000-4000-8000-000000000001', 'd3100000-0000-4000-8000-000000000001', 'd3200000-0000-4000-8000-000000000001', 'september', 'September meeting', '2030-09-12'),
  ('d3400000-0000-4000-8000-000000000002', 'd3100000-0000-4000-8000-000000000002', 'd3200000-0000-4000-8000-000000000002', 'september', 'September meeting', '2030-09-12');

INSERT INTO plugin_data.csf_meeting_attendance (
  organization_id, profile_id, term_id, term_meeting_id, meeting_key,
  meeting_label, status, source, match_status
) VALUES
  ('d3100000-0000-4000-8000-000000000001', 'd3300000-0000-4000-8000-000000000001', 'd3200000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001', 'september', 'September meeting', 'attended', 'sheet', 'confirmed'),
  ('d3100000-0000-4000-8000-000000000001', 'd3300000-0000-4000-8000-000000000002', 'd3200000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001', 'september', 'September meeting', 'attended', 'sheet', 'confirmed');

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'd3100000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001',
    'd3300000-0000-4000-8000-000000000001', 'set', 'excused', 'Adviser approved the documented absence.',
    'd3000000-0000-4000-8000-000000000001', 'd3500000-0000-4000-8000-000000000001'
  ) $$,
  'an officer can explicitly correct imported attendance'
);
SELECT extensions.is(
  (SELECT status || ':' || source FROM plugin_data.csf_meeting_attendance WHERE profile_id = 'd3300000-0000-4000-8000-000000000001'),
  'excused:manual',
  'the corrected row records its status and manual source'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance WHERE profile_id = 'd3300000-0000-4000-8000-000000000001'),
  1,
  'a correction updates the one canonical attendance row'
);
SELECT extensions.is(
  (SELECT action FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd3500000-0000-4000-8000-000000000001'),
  'meeting.attendance_manual_corrected',
  'the correction and immutable audit event share a transaction'
);
SELECT extensions.is(
  (SELECT before_data->>'source' FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd3500000-0000-4000-8000-000000000001'),
  'sheet',
  'the audit event preserves the imported source that was corrected'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'd3100000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001',
    'd3300000-0000-4000-8000-000000000003', 'set', 'attended', 'Attempted cross-tenant correction.',
    'd3000000-0000-4000-8000-000000000001', NULL
  ) $$,
  'P0001', 'CSF member not found.',
  'a member from another organization cannot be corrected'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'd3100000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001',
    'd3300000-0000-4000-8000-000000000002', 'remove', 'unknown', 'Attempted to remove immutable Sheet evidence.',
    'd3000000-0000-4000-8000-000000000001', NULL
  ) $$,
  'P0001', 'Only a manual attendance correction can be removed.',
  'imported evidence cannot be removed as a manual correction'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'd3100000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001',
    'd3300000-0000-4000-8000-000000000002', 'set', 'missed', 'Officer confirmed this student did not attend.',
    'd3000000-0000-4000-8000-000000000001', 'd3500000-0000-4000-8000-000000000002'
  ) $$,
  'a second member can receive a manual correction'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_correct_meeting_attendance(
    'd3100000-0000-4000-8000-000000000001', 'd3400000-0000-4000-8000-000000000001',
    'd3300000-0000-4000-8000-000000000002', 'remove', 'unknown', 'Officer removed the mistaken manual correction.',
    'd3000000-0000-4000-8000-000000000001', 'd3500000-0000-4000-8000-000000000003'
  ) $$,
  'an officer can remove an existing manual correction with a reason'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_meeting_attendance WHERE profile_id = 'd3300000-0000-4000-8000-000000000002'),
  0,
  'removing the manual correction deletes only that operational row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action IN ('meeting.attendance_manual_corrected', 'meeting.attendance_manual_removed')),
  3,
  'every successful correction and removal retains an audit event'
);

SELECT extensions.finish();
ROLLBACK;
