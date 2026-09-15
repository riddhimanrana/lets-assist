-- An unrecognised attendance mark is no longer read as attendance.
--
-- The previous trailing default was `attended`, on the reasoning that "an
-- unrecognized mark on a attendance sheet is a mark". Production disproves
-- that: when a meeting column is misaligned the cell holds an activity title,
-- and an activity title is not a mark. Reading it as attendance credits a
-- student for a meeting the sheet does not record.
--
-- `unknown` is already a valid status, already the column default, and already
-- what a blank cell produces. Unrecognised values now join it, so an officer
-- sees and resolves them instead of inheriting a silent guess.
--
-- Rows already committed under the old behaviour are corrected separately and
-- under review: one of the two affected markers needs a human to confirm what
-- the source sheet means by it.

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
    ELSE 'unknown'
  END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_meeting_attendance_value(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_meeting_attendance_value(text) IS
  'Maps a raw sheet attendance mark to a status. Unrecognised values are unknown, never attended, so a misread cell cannot award credit.';

COMMIT;
