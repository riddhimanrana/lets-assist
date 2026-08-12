-- Treat a job claim as a provisional lease attempt. A worker that reaches the
-- authoritative finalizer completed a healthy bounded pass, even when fair
-- draining leaves more owed deliveries for a later run. Only an abandoned
-- lease reaches the reaper with its provisional attempt still consumed.

REVOKE ALL ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_project_cancellation_job(
  p_job_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.project_cancellation_jobs%ROWTYPE;
  v_total integer := 0;
  v_open integer := 0;
  v_unknown integer := 0;
  v_failed integer := 0;
  v_status text;
  v_error text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_job_id IS NULL OR NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'finalize_project_cancellation_job: invalid input'
      USING ERRCODE = '22023';
  END IF;

  SELECT jobs.* INTO v_job
  FROM public.project_cancellation_jobs AS jobs
  WHERE jobs.id = p_job_id
    AND jobs.status = 'processing'
    AND jobs.lease_owner = p_worker_id
    AND jobs.lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('finalized', false, 'reason', 'lease_lost');
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE deliveries.work_state = 'leased'
         OR deliveries.email_state IN ('queued', 'sending')
         OR deliveries.notification_state = 'queued'
    )::integer,
    count(*) FILTER (WHERE deliveries.email_state = 'unknown_outcome')::integer,
    count(*) FILTER (
      WHERE deliveries.email_state = 'failed'
         OR deliveries.notification_state = 'failed'
    )::integer
  INTO v_total, v_open, v_unknown, v_failed
  FROM public.project_cancellation_deliveries AS deliveries
  WHERE deliveries.job_id = p_job_id;

  IF v_job.audience_snapshot_at IS NULL THEN
    v_status := 'needs_review';
    v_error := 'audience_snapshot_missing';
  ELSIF v_job.recipient_count IS DISTINCT FROM v_total THEN
    v_status := 'needs_review';
    v_error := 'audience_count_mismatch';
  ELSIF v_open > 0 THEN
    v_status := 'pending';
    v_error := NULL;
  ELSIF v_unknown > 0 THEN
    v_status := 'needs_review';
    v_error := 'ambiguous_provider_outcome';
  ELSIF v_failed > 0 THEN
    v_status := 'needs_review';
    v_error := 'owed_channel_failed';
  ELSE
    v_status := 'completed';
    v_error := NULL;
  END IF;

  UPDATE public.project_cancellation_jobs AS jobs
  SET status = v_status,
      -- claim_project_cancellation_jobs increments provisionally. Reaching this
      -- owned, unexpired finalizer proves the pass itself did not fail.
      attempts = GREATEST(v_job.attempts - 1, 0),
      lease_owner = NULL,
      lease_expires_at = NULL,
      processing_started_at = NULL,
      completed_at = CASE
        WHEN v_status IN ('completed', 'needs_review', 'failed') THEN v_now
        ELSE NULL
      END,
      last_error = v_error,
      updated_at = v_now
  WHERE jobs.id = p_job_id;

  RETURN pg_catalog.jsonb_build_object(
    'finalized', true,
    'status', v_status,
    'open', v_open,
    'unknown', v_unknown,
    'failed', v_failed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_project_cancellation_job(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_project_cancellation_job(uuid, text) IS
  'Finalizes an owned cancellation job lease and refunds its provisional claim attempt; only abandoned leases retain attempts for bounded reaping.';
