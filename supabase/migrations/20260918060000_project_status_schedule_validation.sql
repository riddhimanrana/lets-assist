-- A malformed historical schedule must not abort status updates for all projects.
-- Blank date/time fields have no default in the project schedule contract.
CREATE FUNCTION private.project_status_schedule_window(
  p_event_type text,
  p_schedule jsonb,
  p_timezone text
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  segments jsonb := '[]'::jsonb;
  day_value jsonb;
  slot_value jsonb;
  segment jsonb;
  date_text text;
  start_text text;
  end_text text;
  local_start timestamp;
  local_end timestamp;
  instant_start timestamptz;
  instant_end timestamptz;
  zone text := coalesce(nullif(btrim(p_timezone), ''), 'UTC');
BEGIN
  IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  CASE p_event_type
    WHEN 'oneTime' THEN
      segments := jsonb_build_array(p_schedule->'oneTime');
    WHEN 'sameDayMultiArea' THEN
      day_value := p_schedule->'sameDayMultiArea';
      segments := jsonb_build_array(jsonb_build_object(
        'date', day_value->>'date',
        'startTime', day_value->>'overallStart',
        'endTime', day_value->>'overallEnd'
      ));
    WHEN 'multiDay' THEN
      IF jsonb_typeof(p_schedule->'multiDay') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_schedule->'multiDay') = 0 THEN RETURN; END IF;
      FOR day_value IN SELECT value FROM jsonb_array_elements(p_schedule->'multiDay') LOOP
        IF jsonb_typeof(day_value->'slots') IS DISTINCT FROM 'array'
          OR jsonb_array_length(day_value->'slots') = 0 THEN RETURN; END IF;
        FOR slot_value IN SELECT value FROM jsonb_array_elements(day_value->'slots') LOOP
          segments := segments || jsonb_build_array(jsonb_build_object(
            'date', day_value->>'date',
            'startTime', slot_value->>'startTime',
            'endTime', slot_value->>'endTime'
          ));
        END LOOP;
      END LOOP;
    ELSE RETURN;
  END CASE;

  FOR segment IN SELECT value FROM jsonb_array_elements(segments) LOOP
    date_text := segment->>'date';
    start_text := segment->>'startTime';
    end_text := segment->>'endTime';
    IF date_text IS NULL OR date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR start_text IS NULL OR start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR end_text IS NULL OR end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    THEN RETURN; END IF;
    local_start := date_text::date + start_text::time;
    local_end := date_text::date + end_text::time;
    IF to_char(local_start, 'YYYY-MM-DD') <> date_text
      OR local_end < local_start THEN RETURN; END IF;
    instant_start := local_start AT TIME ZONE zone;
    instant_end := local_end AT TIME ZONE zone;
    -- Like the application parser, reject nonexistent wall-clock times at DST.
    IF instant_start AT TIME ZONE zone <> local_start
      OR instant_end AT TIME ZONE zone <> local_end THEN RETURN; END IF;
    starts_at := least(starts_at, instant_start);
    ends_at := greatest(ends_at, instant_end);
  END LOOP;
  IF starts_at IS NOT NULL AND ends_at IS NOT NULL THEN RETURN NEXT; END IF;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN
    RETURN;
END;
$$;
ALTER FUNCTION private.project_status_schedule_window(text, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.project_status_schedule_window(text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.project_status_schedule_window(text, jsonb, text) TO service_role;

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
    WHERE status IN ('in-progress', 'upcoming')
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
