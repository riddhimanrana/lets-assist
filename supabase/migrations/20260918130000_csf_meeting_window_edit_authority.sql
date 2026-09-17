-- Changing a saved response cutoff requires the attendance reconciliation role.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_before text := $anchor$    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting was not found in this organization and semester.';
    END IF;$anchor$;
  v_after text := $anchor$    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting was not found in this organization and semester.';
    END IF;

    IF p_attendance_window IS NOT NULL
      AND (v_legacy.settings -> 'attendanceWindow') IS DISTINCT FROM p_attendance_window THEN
      PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
        p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
      );
    END IF;$anchor$;
BEGIN
  v_definition := pg_get_functiondef(
    'plugin_data.csf_upsert_term_meeting_with_attendance_window(uuid,uuid,uuid,text,date[],timestamptz,text,text,boolean,integer,text,uuid,uuid,jsonb)'::regprocedure
  );
  IF (length(v_definition) - length(replace(v_definition, v_before, '')))
      <> length(v_before) THEN
    RAISE EXCEPTION 'The reviewed CSF meeting edit function changed.';
  END IF;
  EXECUTE replace(v_definition, v_before, v_after);
END;
$migration$;

ALTER FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(
  uuid, uuid, uuid, text, date[], timestamptz, text, text, boolean,
  integer, text, uuid, uuid, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(
  uuid, uuid, uuid, text, date[], timestamptz, text, text, boolean,
  integer, text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(
  uuid, uuid, uuid, text, date[], timestamptz, text, text, boolean,
  integer, text, uuid, uuid, jsonb
) TO postgres, service_role;

COMMIT;
