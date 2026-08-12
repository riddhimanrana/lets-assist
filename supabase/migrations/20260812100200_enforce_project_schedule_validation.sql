-- Direct authenticated writes to public.projects must obey the same timezone
-- and recurrence contract as Server Actions. Existing rows are deliberately
-- not scanned: the trigger validates inserts and only the schedule fields that
-- an UPDATE actually changes, so unrelated edits to legacy rows remain safe.

CREATE OR REPLACE FUNCTION private.project_timezone_is_valid(p_timezone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_timezone IS NOT NULL
    AND length(p_timezone) > 0
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS timezone
      WHERE timezone.name = p_timezone
    );
$$;

CREATE OR REPLACE FUNCTION private.project_recurrence_rule_is_valid(p_rule jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_interval numeric;
  v_end_occurrences numeric;
  v_end_date_text text;
  v_end_date date;
BEGIN
  IF p_rule IS NULL THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_rule) <> 'object' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_rule) AS key(name)
    WHERE key.name NOT IN (
      'frequency', 'interval', 'end_type', 'end_date',
      'end_occurrences', 'weekdays'
    )
  ) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_rule->'frequency') <> 'string'
    OR p_rule->>'frequency' NOT IN ('daily', 'weekly', 'monthly', 'yearly')
    OR jsonb_typeof(p_rule->'interval') <> 'number'
    OR jsonb_typeof(p_rule->'end_type') <> 'string'
    OR p_rule->>'end_type' NOT IN ('never', 'on_date', 'after_occurrences')
  THEN
    RETURN false;
  END IF;

  BEGIN
    v_interval := (p_rule->>'interval')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_interval <> trunc(v_interval)
    OR v_interval < 1
    OR v_interval > 365
  THEN
    RETURN false;
  END IF;

  -- A supplied date is never ignored merely because another end_type is active.
  IF p_rule ? 'end_date' AND jsonb_typeof(p_rule->'end_date') <> 'null' THEN
    IF jsonb_typeof(p_rule->'end_date') <> 'string' THEN
      RETURN false;
    END IF;
    v_end_date_text := p_rule->>'end_date';
    IF v_end_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RETURN false;
    END IF;
    BEGIN
      v_end_date := v_end_date_text::date;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF to_char(v_end_date, 'YYYY-MM-DD') <> v_end_date_text THEN
      RETURN false;
    END IF;
  END IF;

  IF p_rule->>'end_type' = 'on_date'
    AND (
      NOT (p_rule ? 'end_date')
      OR jsonb_typeof(p_rule->'end_date') = 'null'
    )
  THEN
    RETURN false;
  END IF;

  IF p_rule ? 'end_occurrences'
    AND jsonb_typeof(p_rule->'end_occurrences') <> 'null'
  THEN
    IF jsonb_typeof(p_rule->'end_occurrences') <> 'number' THEN
      RETURN false;
    END IF;
    BEGIN
      v_end_occurrences := (p_rule->>'end_occurrences')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF v_end_occurrences <> trunc(v_end_occurrences)
      OR v_end_occurrences < 1
      OR v_end_occurrences > 52
    THEN
      RETURN false;
    END IF;
  END IF;

  IF p_rule->>'end_type' = 'after_occurrences'
    AND (
      NOT (p_rule ? 'end_occurrences')
      OR jsonb_typeof(p_rule->'end_occurrences') = 'null'
    )
  THEN
    RETURN false;
  END IF;

  IF p_rule ? 'weekdays' THEN
    IF jsonb_typeof(p_rule->'weekdays') <> 'array' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(p_rule->'weekdays') > 7
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_rule->'weekdays') AS weekday(value)
        WHERE jsonb_typeof(weekday.value) <> 'string'
          OR (weekday.value #>> '{}') NOT IN (
            'monday', 'tuesday', 'wednesday', 'thursday',
            'friday', 'saturday', 'sunday'
          )
      )
    THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_project_schedule_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.project_timezone IS DISTINCT FROM OLD.project_timezone
    )
  THEN
    IF NOT private.project_timezone_is_valid(NEW.project_timezone) THEN
      RAISE EXCEPTION 'projects.project_timezone must be a valid IANA timezone'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule
    )
  THEN
    IF NOT private.project_recurrence_rule_is_valid(NEW.recurrence_rule) THEN
      RAISE EXCEPTION 'projects.recurrence_rule violates the recurrence contract'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_project_schedule_validation ON public.projects;
CREATE TRIGGER enforce_project_schedule_validation
BEFORE INSERT OR UPDATE OF project_timezone, recurrence_rule ON public.projects
FOR EACH ROW
EXECUTE FUNCTION private.enforce_project_schedule_validation();

REVOKE ALL ON FUNCTION private.project_timezone_is_valid(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.project_timezone_is_valid(text)
  TO service_role;

REVOKE ALL ON FUNCTION private.project_recurrence_rule_is_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.project_recurrence_rule_is_valid(jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION private.enforce_project_schedule_validation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_project_schedule_validation()
  TO service_role;
