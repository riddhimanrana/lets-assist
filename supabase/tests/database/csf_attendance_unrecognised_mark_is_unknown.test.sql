-- Pins the attendance fix from 20260915190000.
--
-- The fallback is easy to regress back to "attended", so the two markers that
-- were being miscounted are asserted explicitly rather than by sampling.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(9);

-- ---------------------------------------------------------------------------
-- Attendance marks
-- ---------------------------------------------------------------------------

SELECT extensions.is(plugin_data.csf_meeting_attendance_value('X'), 'attended',
  'an X is attendance');
SELECT extensions.is(plugin_data.csf_meeting_attendance_value('x'), 'attended',
  'a lowercase x is attendance');
SELECT extensions.is(plugin_data.csf_meeting_attendance_value('YES'), 'attended',
  'the other class convention is attendance');
SELECT extensions.is(plugin_data.csf_meeting_attendance_value('NO'), 'missed',
  'NO is a miss');
SELECT extensions.is(plugin_data.csf_meeting_attendance_value('N/A'), 'not_required',
  'N/A is not required');

-- The regression the fix exists for. Both of these read as `attended` before.
SELECT extensions.is(plugin_data.csf_meeting_attendance_value('.'), 'unknown',
  'a bare dot is unknown, not attendance');
SELECT extensions.is(
  plugin_data.csf_meeting_attendance_value('Ho Ho Holiday Carnival'), 'unknown',
  'an activity title in a misaligned meeting column is unknown, not attendance');

SELECT extensions.is(plugin_data.csf_meeting_attendance_value(''), 'unknown',
  'a blank cell is unknown');
SELECT extensions.is(plugin_data.csf_meeting_attendance_value(NULL), 'unknown',
  'a missing cell is unknown');

SELECT extensions.finish();

ROLLBACK;
