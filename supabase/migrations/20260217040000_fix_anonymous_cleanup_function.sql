-- Fix anonymous profile retention cleanup to match post-revamp schema (no signup_id on anonymous_signups)
-- and keep cron scheduled in a sane daily cadence.

DROP FUNCTION IF EXISTS public.delete_old_anonymous_signups();

CREATE FUNCTION public.delete_old_anonymous_signups()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  deleted_count integer := 0;
BEGIN
  WITH project_end_dates AS (
    SELECT
      ps.anonymous_id,
      MAX(
        CASE
          WHEN p.event_type = 'oneTime' THEN NULLIF(p.schedule->'oneTime'->>'date', '')::date
          WHEN p.event_type = 'sameDayMultiArea' THEN NULLIF(p.schedule->'sameDayMultiArea'->>'date', '')::date
          WHEN p.event_type = 'multiDay' THEN (
            SELECT MAX(NULLIF(day->>'date', '')::date)
            FROM jsonb_array_elements(COALESCE(p.schedule->'multiDay', '[]'::jsonb)) AS day
          )
          ELSE NULL
        END
      ) AS project_end_date
    FROM public.project_signups ps
    JOIN public.projects p ON p.id = ps.project_id
    WHERE ps.anonymous_id IS NOT NULL
    GROUP BY ps.anonymous_id
  ),
  candidates AS (
    SELECT a.id
    FROM public.anonymous_signups a
    LEFT JOIN project_end_dates ped ON ped.anonymous_id = a.id
    WHERE a.linked_user_id IS NULL
      AND (
        (ped.project_end_date IS NOT NULL AND ped.project_end_date < (CURRENT_DATE - INTERVAL '30 days')::date)
        OR
        (ped.project_end_date IS NULL AND a.created_at < NOW() - INTERVAL '30 days')
      )
  ),
  deleted_signups AS (
    DELETE FROM public.project_signups ps
    USING candidates c
    WHERE ps.anonymous_id = c.id
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.anonymous_signups a
    USING candidates c
    WHERE a.id = c.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$function$;
