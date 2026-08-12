-- Split the feedback lease into a retry-safe preparation phase and an
-- at-most-once dispatch phase. Only a worker that has durably crossed into
-- dispatching may call the provider; only an expired dispatch can become an
-- unknown outcome.

ALTER TABLE public.project_feedback_requests
  DROP CONSTRAINT project_feedback_requests_state_check,
  DROP CONSTRAINT project_feedback_requests_lease_shape;

-- An old `leased` row could already have reached the provider. Preserve the
-- conservative at-most-once posture during upgrade by treating it as dispatching.
UPDATE public.project_feedback_requests
SET state = 'dispatching',
    updated_at = now()
WHERE state = 'leased';

-- Older workers could requeue their third claimed attempt. Such rows were no
-- longer claimable; settle them explicitly instead of retaining frozen work.
UPDATE public.project_feedback_requests
SET state = 'failed',
    failure_code = 'attempts_exhausted',
    settled_at = now(),
    updated_at = now()
WHERE state = 'queued'
  AND attempts >= 3;

ALTER TABLE public.project_feedback_requests
  ADD CONSTRAINT project_feedback_requests_state_check CHECK (
    state IN (
      'queued', 'preparing', 'dispatching',
      'sent', 'skipped', 'failed', 'unknown_outcome'
    )
  ),
  ADD CONSTRAINT project_feedback_requests_lease_shape CHECK (
    (state IN ('preparing', 'dispatching'))
      = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

DROP INDEX public.project_feedback_requests_lease_idx;
CREATE INDEX project_feedback_requests_lease_idx
  ON public.project_feedback_requests (lease_expires_at)
  WHERE state IN ('preparing', 'dispatching');

COMMENT ON COLUMN public.project_feedback_requests.state IS
  'queued -> preparing -> dispatching -> terminal. Expired preparing is retryable; expired dispatching is unknown_outcome and never retried.';

-- Keep the original claim RPC conservative for workers from the preceding
-- deployment. They send immediately after claiming, so treating their lease as
-- dispatching is the only upgrade-safe interpretation while versions overlap.
CREATE OR REPLACE FUNCTION public.claim_project_feedback_requests(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  signup_id uuid,
  user_id uuid,
  anonymous_id uuid,
  attempts smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(BTRIM(p_worker_id), '') IS NULL
    OR COALESCE(p_limit, 0) < 1
    OR COALESCE(p_lease_seconds, 0) < 1
  THEN
    RAISE EXCEPTION 'claim_project_feedback_requests: invalid input';
  END IF;

  RETURN QUERY
  UPDATE public.project_feedback_requests AS requests
  SET state = 'dispatching',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = requests.attempts + 1,
      failure_code = NULL,
      updated_at = now()
  WHERE requests.id IN (
    SELECT candidates.id
    FROM public.project_feedback_requests AS candidates
    WHERE candidates.state = 'queued'
      AND candidates.eligible_at <= now()
      AND candidates.attempts < 3
    ORDER BY candidates.eligible_at, candidates.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING requests.id, requests.project_id, requests.signup_id,
            requests.user_id, requests.anonymous_id, requests.attempts;
END;
$$;

-- New workers claim into the retry-safe preparation phase and must explicitly
-- cross begin_project_feedback_request_dispatch before contacting a provider.
CREATE OR REPLACE FUNCTION public.claim_project_feedback_requests_for_preparation(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  signup_id uuid,
  user_id uuid,
  anonymous_id uuid,
  attempts smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(BTRIM(p_worker_id), '') IS NULL
    OR COALESCE(p_limit, 0) < 1
    OR COALESCE(p_lease_seconds, 0) < 1
  THEN
    RAISE EXCEPTION 'claim_project_feedback_requests_for_preparation: invalid input';
  END IF;

  RETURN QUERY
  UPDATE public.project_feedback_requests AS requests
  SET state = 'preparing',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      failure_code = NULL,
      updated_at = now()
  WHERE requests.id IN (
    SELECT candidates.id
    FROM public.project_feedback_requests AS candidates
    WHERE candidates.state = 'queued'
      AND candidates.eligible_at <= now()
      AND candidates.attempts < 3
    ORDER BY candidates.eligible_at, candidates.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING requests.id, requests.project_id, requests.signup_id,
            requests.user_id, requests.anonymous_id, requests.attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_project_feedback_request_dispatch(
  p_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts smallint;
BEGIN
  IF p_id IS NULL
    OR NULLIF(BTRIM(p_worker_id), '') IS NULL
    OR COALESCE(p_lease_seconds, 0) < 1
  THEN
    RAISE EXCEPTION 'begin_project_feedback_request_dispatch: invalid input';
  END IF;

  UPDATE public.project_feedback_requests AS requests
  SET state = 'dispatching',
      attempts = requests.attempts + 1,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE requests.id = p_id
    AND requests.state = 'preparing'
    AND requests.lease_owner = p_worker_id
    AND requests.lease_expires_at >= now()
    AND requests.attempts < 3
  RETURNING requests.attempts INTO v_attempts;

  IF v_attempts IS NULL THEN
    RAISE EXCEPTION 'feedback request is not held in an active preparing lease'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_project_feedback_request_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preparing integer := 0;
  v_dispatching integer := 0;
BEGIN
  UPDATE public.project_feedback_requests AS requests
  SET state = 'queued',
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = 'preparation_lease_expired',
      settled_at = NULL,
      updated_at = now()
  WHERE requests.state = 'preparing'
    AND requests.lease_expires_at < now();
  GET DIAGNOSTICS v_preparing = ROW_COUNT;

  UPDATE public.project_feedback_requests AS requests
  SET state = 'unknown_outcome',
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = 'dispatch_lease_expired',
      settled_at = now(),
      updated_at = now()
  WHERE requests.state = 'dispatching'
    AND requests.lease_expires_at < now();
  GET DIAGNOSTICS v_dispatching = ROW_COUNT;

  RETURN v_preparing + v_dispatching;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_project_feedback_request(
  p_id uuid,
  p_worker_id text,
  p_state text,
  p_provider_message_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
BEGIN
  IF p_id IS NULL
    OR NULLIF(BTRIM(p_worker_id), '') IS NULL
    OR p_state NOT IN ('sent', 'skipped', 'failed', 'unknown_outcome', 'queued')
  THEN
    RAISE EXCEPTION 'settle_project_feedback_request: invalid input';
  END IF;

  UPDATE public.project_feedback_requests AS requests
  SET state = CASE
        WHEN p_state = 'queued' AND requests.attempts >= 3 THEN 'failed'
        ELSE p_state
      END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_message_id = COALESCE(
        p_provider_message_id,
        requests.provider_message_id
      ),
      failure_code = CASE
        WHEN p_state = 'queued' AND requests.attempts >= 3
          THEN 'attempts_exhausted'
        ELSE p_failure_code
      END,
      settled_at = CASE
        WHEN p_state = 'queued' AND requests.attempts < 3 THEN NULL
        ELSE now()
      END,
      updated_at = now()
  WHERE requests.id = p_id
    AND requests.lease_owner = p_worker_id
    AND (
      (
        requests.state = 'preparing'
        AND p_state IN ('skipped', 'failed', 'queued')
      )
      OR (
        requests.state = 'dispatching'
        AND p_state IN (
          'sent', 'skipped', 'failed', 'unknown_outcome', 'queued'
        )
      )
    )
  RETURNING requests.state INTO v_state;

  IF v_state IS NULL THEN
    SELECT requests.state INTO v_state
    FROM public.project_feedback_requests AS requests
    WHERE requests.id = p_id;
  END IF;

  RETURN COALESCE(v_state, 'missing');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_project_feedback_requests(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_feedback_requests(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_feedback_requests_for_preparation(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_feedback_requests_for_preparation(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_project_feedback_request_dispatch(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_project_feedback_request_dispatch(uuid, text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_feedback_request_leases()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_project_feedback_request_leases()
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_project_feedback_request(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_project_feedback_request(uuid, text, text, text, text)
  TO service_role;
