-- Leave projects with zero-length schedule windows unchanged during status
-- maintenance, matching the event editor's time ordering rule.
CREATE OR REPLACE FUNCTION private.project_status_schedule_window(
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
  role_value jsonb;
  segment jsonb;
  date_text text;
  start_text text;
  end_text text;
  role_start_text text;
  role_end_text text;
  local_start timestamp;
  local_end timestamp;
  role_start timestamp;
  role_end timestamp;
  instant_start timestamptz;
  instant_end timestamptz;
  zone text := coalesce(nullif(btrim(p_timezone), ''), 'America/Los_Angeles');
BEGIN
  IF jsonb_typeof(p_schedule) IS DISTINCT FROM 'object' THEN RETURN; END IF;
  CASE p_event_type
    WHEN 'oneTime' THEN
      segments := jsonb_build_array(p_schedule->'oneTime');
    WHEN 'sameDayMultiArea' THEN
      day_value := p_schedule->'sameDayMultiArea';
      IF jsonb_typeof(day_value) IS DISTINCT FROM 'object' THEN RETURN; END IF;
      IF jsonb_typeof(day_value->'roles') IS DISTINCT FROM 'array' THEN RETURN; END IF;
      IF jsonb_array_length(day_value->'roles') = 0 THEN RETURN; END IF;
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
      OR local_end <= local_start THEN RETURN; END IF;
    instant_start := local_start AT TIME ZONE zone;
    instant_end := local_end AT TIME ZONE zone;
    IF instant_start AT TIME ZONE zone <> local_start
      OR instant_end AT TIME ZONE zone <> local_end THEN RETURN; END IF;
    starts_at := least(starts_at, instant_start);
    ends_at := greatest(ends_at, instant_end);
  END LOOP;

  IF p_event_type = 'sameDayMultiArea' THEN
    IF local_end <= local_start THEN RETURN; END IF;
    FOR role_value IN SELECT value FROM jsonb_array_elements(day_value->'roles') LOOP
      IF jsonb_typeof(role_value) IS DISTINCT FROM 'object' THEN RETURN; END IF;
      role_start_text := role_value->>'startTime';
      role_end_text := role_value->>'endTime';
      IF role_start_text IS NULL OR role_start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR role_end_text IS NULL OR role_end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN RETURN; END IF;
      role_start := date_text::date + role_start_text::time;
      role_end := date_text::date + role_end_text::time;
      IF role_start < local_start OR role_end > local_end OR role_end <= role_start
        OR (role_start AT TIME ZONE zone) AT TIME ZONE zone <> role_start
        OR (role_end AT TIME ZONE zone) AT TIME ZONE zone <> role_end
      THEN RETURN; END IF;
    END LOOP;
  END IF;

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
