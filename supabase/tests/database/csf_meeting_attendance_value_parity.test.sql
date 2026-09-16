BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(3);

-- The exact table normalizeCsfMeetingAttendanceValue produces, kept beside the
-- identical table in domain.test.ts. The import writes the SQL side, so a
-- disagreement between the two is a silently wrong attendance record.
CREATE TEMP TABLE csf_meeting_attendance_parity AS
SELECT * FROM (VALUES
  (NULL::text, 'unknown'::text),
  ('', 'unknown'),
  ('   ', 'unknown'),
  ('x', 'attended'),
  ('X', 'attended'),
  ('  Yes  ', 'attended'),
  ('y', 'attended'),
  ('true', 'attended'),
  ('attended', 'attended'),
  ('present', 'attended'),
  ('complete', 'attended'),
  ('completed', 'attended'),
  ('excused', 'excused'),
  ('e', 'excused'),
  ('missed', 'missed'),
  ('absent', 'missed'),
  ('no', 'missed'),
  ('n', 'missed'),
  ('false', 'missed'),
  ('not required', 'not_required'),
  ('not_required', 'not_required'),
  ('n/a', 'not_required'),
  ('na', 'not_required'),
  ('.', 'unknown'),
  ('Beach cleanup', 'unknown'),
  ('11/12 November meeting', 'unknown'),
  ('?', 'unknown'),
  -- H2: JavaScript trim strips more than spaces, so the SQL side has to as
  -- well or the two normalizers disagree for any writer that does not
  -- pre-trim. Tab, newline, NBSP and BOM, leading and trailing.
  (E'\tx', 'attended'),
  (E'x\n', 'attended'),
  (E'\u00A0excused\u00A0', 'excused'),
  (E'\uFEFFmissed', 'missed'),
  (E'\u00A0\t\n', 'unknown')
) AS parity(input, expected);

SELECT extensions.is(
  (SELECT count(*)::integer FROM csf_meeting_attendance_parity AS parity
   WHERE plugin_data.csf_meeting_attendance_value(parity.input)
     IS DISTINCT FROM parity.expected),
  0,
  'every reviewed attendance mark resolves the way the TypeScript twin does'
);
SELECT extensions.is(
  plugin_data.csf_meeting_attendance_value('Beach cleanup'),
  'unknown',
  'an activity title in a misaligned meeting column is never attendance'
);

SELECT extensions.is(
  plugin_data.csf_meeting_attendance_value(E'\tx'),
  'attended',
  'a tab-prefixed mark trims the way the TypeScript twin trims it'
);

SELECT * FROM extensions.finish();
ROLLBACK;
