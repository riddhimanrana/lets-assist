-- The plugin shipped half of this fix and the database kept the other half.
--
-- normalizeCsfMeetingAttendanceValue stopped treating an unrecognised mark as
-- attendance in lets-assist-plugins#446, on the evidence that a misaligned
-- meeting column holds an activity title rather than a mark. The SQL mirror
-- that actually writes the imported value was named in that commit but never
-- landed here, so every import since has still resolved an unrecognised mark
-- to 'attended' while the TypeScript twin resolved it to 'unknown'.
--
-- This lands the missing half. Genuine attendance that the sheet records as a
-- coloured box with no text now arrives as an explicit 'attended' from the
-- parser, so nothing depends on the old guess any more.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_meeting_attendance_value(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))), '') IS NULL
      THEN 'unknown'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'x', 'yes', 'y', 'true', 'attended', 'present', 'complete', 'completed'
    ]) THEN 'attended'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY['excused', 'e'])
      THEN 'excused'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'missed', 'absent', 'no', 'n', 'false'
    ]) THEN 'missed'
    WHEN pg_catalog.lower(pg_catalog.btrim(p_value)) = ANY (ARRAY[
      'not required', 'not_required', 'n/a', 'na'
    ]) THEN 'not_required'
    -- Anything we do not recognise is unknown, never attended. It reaches an
    -- officer instead of silently crediting a meeting the sheet never records.
    ELSE 'unknown'
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  TO postgres;

COMMENT ON FUNCTION plugin_data.csf_meeting_attendance_value(text) IS
  'Mirrors normalizeCsfMeetingAttendanceValue exactly, including that an unrecognised mark is unknown rather than attended.';

COMMIT;
