-- Bound the feedback worker's rotating candidate set to recent, incomplete
-- enqueue work. Exact timezone-aware eligibility remains in TypeScript; the
-- calendar date extracted here is deliberately only a conservative indexable
-- prefilter.

BEGIN;

CREATE OR REPLACE FUNCTION private.project_feedback_candidate_end_date(
  p_event_type text,
  p_schedule jsonb
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_date_text text;
BEGIN
  CASE p_event_type
    WHEN 'oneTime' THEN
      v_date_text := p_schedule #>> '{oneTime,date}';
    WHEN 'sameDayMultiArea' THEN
      v_date_text := p_schedule #>> '{sameDayMultiArea,date}';
    WHEN 'multiDay' THEN
      SELECT max(day_value ->> 'date')
      INTO v_date_text
      FROM jsonb_array_elements(p_schedule -> 'multiDay') AS day_value
      WHERE day_value ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
    ELSE
      RETURN NULL;
  END CASE;

  IF v_date_text IS NULL
    OR v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR to_char(v_date_text::date, 'YYYY-MM-DD') <> v_date_text
  THEN
    RETURN NULL;
  END IF;

  RETURN v_date_text::date;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

ALTER FUNCTION private.project_feedback_candidate_end_date(text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.project_feedback_candidate_end_date(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.project_feedback_candidate_end_date(text, jsonb)
  TO service_role;

COMMENT ON FUNCTION private.project_feedback_candidate_end_date(text, jsonb) IS
  'Returns the final schedule calendar date for an indexable feedback-worker prefilter. It does not decide exact timezone-aware eligibility.';

CREATE INDEX projects_feedback_candidate_end_date_idx
  ON public.projects (
    private.project_feedback_candidate_end_date(event_type, schedule),
    id
  )
  WHERE status = 'completed';

CREATE VIEW public.project_feedback_candidate_read_model
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  projects.id,
  projects.title,
  projects.status,
  projects.event_type,
  projects.schedule,
  projects.project_timezone,
  projects.published,
  projects.cancelled_at,
  projects.organization_id,
  projects.created_at,
  private.project_feedback_candidate_end_date(
    projects.event_type,
    projects.schedule
  ) AS candidate_end_date
FROM public.projects AS projects
WHERE projects.status = 'completed'
  AND private.project_feedback_candidate_end_date(
    projects.event_type,
    projects.schedule
  ) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_signups AS signups
    LEFT JOIN public.profiles AS profiles
      ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anonymous_signups
      ON anonymous_signups.id = signups.anonymous_id
    WHERE signups.project_id = projects.id
      AND signups.status = 'attended'
      AND (
        (
          signups.user_id IS NOT NULL
          AND NULLIF(btrim(profiles.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.project_feedback_requests AS requests
            WHERE requests.project_id = projects.id
              AND requests.user_id = signups.user_id
          )
        )
        OR (
          signups.anonymous_id IS NOT NULL
          AND anonymous_signups.email_opt_out_at IS NULL
          AND NULLIF(btrim(anonymous_signups.email), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.project_feedback_requests AS requests
            WHERE requests.project_id = projects.id
              AND requests.anonymous_id = signups.anonymous_id
          )
        )
      )
  );

ALTER VIEW public.project_feedback_candidate_read_model OWNER TO postgres;
REVOKE ALL ON TABLE public.project_feedback_candidate_read_model
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.project_feedback_candidate_read_model
  TO service_role;

COMMENT ON VIEW public.project_feedback_candidate_read_model IS
  'Service-only feedback-worker candidates with attended identities not yet represented in the durable dispatch ledger.';

COMMIT;
