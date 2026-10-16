-- A role name takes precedence over a positional alias with the same text.
-- Existing signup keys use role names; this changes only future worker reads.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_attendance_slot_window(
  p_project_id uuid,
  p_schedule_id text
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  project record;
  session jsonb;
BEGIN
  IF p_project_id IS NULL OR nullif(btrim(p_schedule_id), '') IS NULL THEN RETURN; END IF;
  SELECT event_type, schedule, project_timezone INTO project
  FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM private.project_status_schedule_window(
      project.event_type, project.schedule, project.project_timezone
    )
  ) THEN RETURN; END IF;

  IF project.event_type = 'oneTime'
    AND p_schedule_id = ANY (ARRAY['oneTime', '0', 'default']) THEN
    session := project.schedule->'oneTime';
  ELSIF project.event_type = 'sameDayMultiArea' THEN
    SELECT role.value || jsonb_build_object('date', project.schedule->'sameDayMultiArea'->>'date')
    INTO session
    FROM jsonb_array_elements(project.schedule->'sameDayMultiArea'->'roles')
      WITH ORDINALITY AS role(value, ordinal)
    WHERE role.value->>'name' = p_schedule_id
       OR p_schedule_id = format('role-%s', role.ordinal - 1)
    ORDER BY CASE WHEN role.value->>'name' = p_schedule_id THEN 0 ELSE 1 END,
      role.ordinal
    LIMIT 1;
  ELSIF project.event_type = 'multiDay' THEN
    SELECT slot.value || jsonb_build_object('date', day.value->>'date')
    INTO session
    FROM jsonb_array_elements(project.schedule->'multiDay')
      WITH ORDINALITY AS day(value, ordinal)
    CROSS JOIN LATERAL jsonb_array_elements(day.value->'slots')
      WITH ORDINALITY AS slot(value, ordinal)
    WHERE p_schedule_id = ANY (ARRAY[
      format('%s-%s-%s', day.value->>'date', day.ordinal - 1, slot.ordinal - 1),
      format('%s-%s', day.ordinal - 1, slot.ordinal - 1),
      format('%s-%s', day.value->>'date', slot.ordinal - 1),
      format('day-%s-slot-%s', day.ordinal - 1, slot.ordinal - 1)
    ])
    ORDER BY day.ordinal, slot.ordinal LIMIT 1;
  END IF;

  IF session IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT session_window.starts_at, session_window.ends_at
  FROM private.project_status_schedule_window(
    'oneTime', jsonb_build_object('oneTime', session), project.project_timezone
  ) AS session_window;
END;
$$;
ALTER FUNCTION private.project_attendance_slot_window(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.project_attendance_slot_window(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.project_attendance_slot_window(uuid, text) TO service_role;

COMMIT;
