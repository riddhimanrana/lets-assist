-- Restore scheduled attendance for named roles and QR end-time checkout.
-- Resolve one exact session through the existing published-schedule validator;
-- missing/blank/invalid times never become midnight credit. This changes worker
-- definitions only: no existing attendance, certificate or CSF points are edited.

BEGIN;

CREATE FUNCTION private.project_attendance_slot_window(
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

  IF project.event_type = 'oneTime' AND p_schedule_id = 'oneTime' THEN
    session := project.schedule->'oneTime';
  ELSIF project.event_type = 'sameDayMultiArea' THEN
    SELECT role.value || jsonb_build_object('date', project.schedule->'sameDayMultiArea'->>'date')
    INTO session
    FROM jsonb_array_elements(project.schedule->'sameDayMultiArea'->'roles')
      WITH ORDINALITY AS role(value, ordinal)
    WHERE role.value->>'name' = p_schedule_id
    ORDER BY role.ordinal LIMIT 1;
  ELSIF project.event_type = 'multiDay' THEN
    SELECT slot.value || jsonb_build_object('date', day.value->>'date')
    INTO session
    FROM jsonb_array_elements(project.schedule->'multiDay')
      WITH ORDINALITY AS day(value, ordinal)
    CROSS JOIN LATERAL jsonb_array_elements(day.value->'slots')
      WITH ORDINALITY AS slot(value, ordinal)
    WHERE p_schedule_id = format('%s-%s-%s', day.value->>'date', day.ordinal - 1, slot.ordinal - 1)
       OR p_schedule_id = format('%s-%s', day.value->>'date', slot.ordinal - 1)
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

CREATE OR REPLACE FUNCTION public.process_automatic_check_ins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup record;
  session record;
  run_at timestamptz := now();
BEGIN
  FOR signup IN
    SELECT signups.id, signups.project_id, signups.schedule_id
    FROM public.project_signups AS signups
    JOIN public.projects AS projects ON projects.id = signups.project_id
    WHERE signups.status = 'approved' AND signups.check_in_time IS NULL
      AND projects.verification_method = 'auto'
      AND projects.status IN ('upcoming', 'in-progress', 'completed')
      AND coalesce(projects.workflow_status, 'published') = 'published'
    ORDER BY projects.id, signups.id
    FOR UPDATE OF projects, signups SKIP LOCKED
  LOOP
    SELECT * INTO session FROM private.project_attendance_slot_window(
      signup.project_id, signup.schedule_id
    );
    IF NOT FOUND OR run_at < session.starts_at THEN CONTINUE; END IF;
    UPDATE public.project_signups
    SET check_in_time = session.starts_at, status = 'attended'
    WHERE id = signup.id AND status = 'approved' AND check_in_time IS NULL;
  END LOOP;
END;
$$;
ALTER FUNCTION public.process_automatic_check_ins() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_automatic_check_ins()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_automatic_check_ins() TO service_role;

CREATE OR REPLACE FUNCTION public.process_automatic_check_outs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup record;
  session record;
  run_at timestamptz := now();
BEGIN
  FOR signup IN
    SELECT signups.id, signups.project_id, signups.schedule_id, signups.check_in_time
    FROM public.project_signups AS signups
    JOIN public.projects AS projects ON projects.id = signups.project_id
    WHERE signups.status = 'attended' AND signups.check_in_time IS NOT NULL
      AND signups.check_out_time IS NULL
      AND projects.verification_method IN ('auto', 'qr-code')
      AND projects.status IN ('upcoming', 'in-progress', 'completed')
      AND coalesce(projects.workflow_status, 'published') = 'published'
    ORDER BY projects.id, signups.id
    FOR UPDATE OF projects, signups SKIP LOCKED
  LOOP
    SELECT * INTO session FROM private.project_attendance_slot_window(
      signup.project_id, signup.schedule_id
    );
    IF NOT FOUND OR run_at < session.ends_at OR signup.check_in_time > session.ends_at
    THEN CONTINUE; END IF;
    UPDATE public.project_signups
    SET check_out_time = session.ends_at
    WHERE id = signup.id AND status = 'attended'
      AND check_in_time = signup.check_in_time AND check_out_time IS NULL;
  END LOOP;
END;
$$;
ALTER FUNCTION public.process_automatic_check_outs() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_automatic_check_outs()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_automatic_check_outs() TO service_role;

COMMIT;
