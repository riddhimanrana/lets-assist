-- Draft schedules may be incomplete and must not enter published status maintenance.
CREATE OR REPLACE FUNCTION public.process_projects()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  project record;
  schedule_window record;
  target_status text;
  invalid_count integer := 0;
  checked_at timestamptz := now();
BEGIN
  FOR project IN
    SELECT id, event_type, schedule, project_timezone, status
    FROM public.projects
    WHERE coalesce(workflow_status, 'published') = 'published'
      AND status IN ('in-progress', 'upcoming')
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO schedule_window FROM private.project_status_schedule_window(
      project.event_type, project.schedule, project.project_timezone
    );
    IF NOT FOUND THEN
      invalid_count := invalid_count + 1;
      CONTINUE;
    END IF;
    target_status := CASE
      WHEN checked_at > schedule_window.ends_at THEN 'completed'
      WHEN checked_at >= schedule_window.starts_at THEN 'in-progress'
      ELSE 'upcoming'
    END;
    IF project.status IS DISTINCT FROM target_status THEN
      UPDATE public.projects SET status = target_status WHERE id = project.id;
    END IF;
  END LOOP;
  IF invalid_count > 0 THEN
    RAISE WARNING 'Project status maintenance left % projects unchanged because their schedules need correction.', invalid_count;
  END IF;
END;
$$;
ALTER FUNCTION public.process_projects() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.process_projects() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_projects() TO service_role;
