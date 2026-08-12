-- The integrated lifecycle migrations at 20260812100500 and 20260812100600
-- intentionally replace these functions as part of their own forward upgrade.
-- Reapply the later hostile-review semantics after the integrated ledger tail
-- so replay order and an incremental Development upgrade converge.

CREATE OR REPLACE FUNCTION app_private.enforce_project_signup_cancellation_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization_id uuid;
  v_project_status text;
  v_approving boolean :=
    NEW.status = 'approved'
    AND (
      TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM 'approved'
      OR OLD.project_id IS DISTINCT FROM NEW.project_id
    );
  v_attending boolean :=
    TG_OP = 'UPDATE'
    AND NEW.status = 'attended'
    AND OLD.status IS DISTINCT FROM 'attended';
BEGIN
  IF NEW.project_id IS NULL THEN
    NEW.organization_id := NULL;
    RETURN NEW;
  END IF;

  IF v_approving OR v_attending THEN
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id
    FOR UPDATE;
  ELSE
    SELECT projects.organization_id, projects.status
    INTO v_organization_id, v_project_status
    FROM public.projects AS projects
    WHERE projects.id = NEW.project_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project signup references a missing project'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.organization_id IS NOT NULL
    AND NEW.organization_id IS DISTINCT FROM v_organization_id
  THEN
    RAISE EXCEPTION 'project signup organization does not match project'
      USING ERRCODE = '23514';
  END IF;

  NEW.organization_id := v_organization_id;

  IF v_approving
    AND (
      v_project_status IS NULL
      OR v_project_status NOT IN ('upcoming', 'in-progress')
    )
  THEN
    RAISE EXCEPTION 'signups can only be approved for active projects'
      USING ERRCODE = '55000';
  END IF;

  IF v_attending
    AND (
      v_project_status IS NULL
      OR v_project_status IN ('inactive', 'cancelled')
    )
  THEN
    RAISE EXCEPTION 'attendance requires an active project'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.enforce_project_signup_cancellation_boundary()
  TO postgres;

COMMENT ON FUNCTION app_private.enforce_project_signup_cancellation_boundary() IS
  'Serializes signup approval and approved-to-attended transitions with project cancellation and rejects inactive or cancelled attendance.';

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
