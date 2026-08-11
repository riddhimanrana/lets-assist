-- Post-project follow-up email dispatch ledger: one row per recipient per
-- project, with partial unique indexes as the at-most-once guarantee,
-- FOR UPDATE SKIP LOCKED leasing, worker-owned settlement, and a reaper
-- that settles expired leases as unknown_outcome instead of re-sending —
-- preserving the email layer's invariant that unknown_outcome is never
-- auto-retried.

-- ---------------------------------------------------------------------------
-- 1. Anonymous opt-out
-- ---------------------------------------------------------------------------

ALTER TABLE public.anonymous_signups
  ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz;

COMMENT ON COLUMN public.anonymous_signups.email_opt_out_at IS
  'When this address asked to stop receiving non-obligatory project mail. Obligatory transactional mail (signup confirmation, cancellation) is unaffected.';

-- ---------------------------------------------------------------------------
-- 2. Dispatch ledger
-- ---------------------------------------------------------------------------

CREATE TABLE public.project_feedback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  signup_id uuid NOT NULL REFERENCES public.project_signups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_id uuid REFERENCES public.anonymous_signups(id) ON DELETE CASCADE,
  -- sha256(lower(trim(address))). The raw address is resolved at send time
  -- from profiles/anonymous_signups, never duplicated here.
  recipient_email_hash text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  attempts smallint NOT NULL DEFAULT 0,
  eligible_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  failure_code text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_feedback_requests_state_check CHECK (
    state IN ('queued', 'leased', 'sent', 'skipped', 'failed', 'unknown_outcome')
  ),
  CONSTRAINT project_feedback_requests_attempts_bound
    CHECK (attempts BETWEEN 0 AND 3),
  CONSTRAINT project_feedback_requests_identity CHECK (
    (user_id IS NOT NULL AND anonymous_id IS NULL)
    OR (user_id IS NULL AND anonymous_id IS NOT NULL)
  ),
  CONSTRAINT project_feedback_requests_lease_shape CHECK (
    (state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.project_feedback_requests IS
  'Service-only dispatch ledger for the post-project feedback email. The partial unique indexes are the at-most-once guarantee.';

CREATE UNIQUE INDEX project_feedback_requests_project_user_uidx
  ON public.project_feedback_requests (project_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_feedback_requests_project_anon_uidx
  ON public.project_feedback_requests (project_id, anonymous_id)
  WHERE anonymous_id IS NOT NULL;
CREATE INDEX project_feedback_requests_claimable_idx
  ON public.project_feedback_requests (eligible_at)
  WHERE state = 'queued';
CREATE INDEX project_feedback_requests_lease_idx
  ON public.project_feedback_requests (lease_expires_at)
  WHERE state = 'leased';

ALTER TABLE public.project_feedback_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_feedback_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.project_feedback_requests TO service_role;

CREATE POLICY "Block all client access to project feedback requests"
  ON public.project_feedback_requests
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 3. Enqueue: distinct attendees of one project
-- ---------------------------------------------------------------------------

-- Eligibility (the +24h floor, published-hours hold, 96h backstop, and the
-- 30-day backfill guard) is computed in TypeScript and passed in as
-- p_eligible_at: process_projects() computes in a hardcoded 'PST' while
-- projects carry project_timezone, so SQL-side schedule math is not trusted
-- for instants.
CREATE OR REPLACE FUNCTION public.enqueue_project_feedback_requests(
  p_project_id uuid,
  p_eligible_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF p_project_id IS NULL OR p_eligible_at IS NULL THEN
    RAISE EXCEPTION 'enqueue_project_feedback_requests: invalid input';
  END IF;

  WITH attendees AS (
    SELECT DISTINCT ON (COALESCE(signups.user_id::text, signups.anonymous_id::text))
      signups.id AS signup_id,
      signups.user_id,
      signups.anonymous_id,
      COALESCE(profiles.email, anon.email) AS email
    FROM public.project_signups AS signups
    LEFT JOIN public.profiles AS profiles ON profiles.id = signups.user_id
    LEFT JOIN public.anonymous_signups AS anon ON anon.id = signups.anonymous_id
    WHERE signups.project_id = p_project_id
      AND signups.status = 'attended'
      AND (signups.anonymous_id IS NULL OR anon.email_opt_out_at IS NULL)
    ORDER BY COALESCE(signups.user_id::text, signups.anonymous_id::text),
             signups.created_at
  ),
  inserted AS (
    INSERT INTO public.project_feedback_requests (
      project_id, signup_id, user_id, anonymous_id,
      recipient_email_hash, eligible_at
    )
    SELECT
      p_project_id,
      attendees.signup_id,
      attendees.user_id,
      attendees.anonymous_id,
      encode(extensions.digest(lower(btrim(attendees.email)), 'sha256'), 'hex'),
      p_eligible_at
    FROM attendees
    WHERE attendees.email IS NOT NULL
      AND length(btrim(attendees.email)) > 0
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Claim: lease queued work, never expired leases
-- ---------------------------------------------------------------------------

-- Deliberately never reclaims an expired lease: an expired lease means the
-- worker died somewhere around the provider call — exactly the
-- unknown_outcome situation. Reclaiming would re-send. The reaper below
-- settles those honestly instead.
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
  SET state = 'leased',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = requests.attempts + 1,
      updated_at = now()
  WHERE requests.id IN (
    SELECT candidates.id
    FROM public.project_feedback_requests AS candidates
    WHERE candidates.state = 'queued'
      AND candidates.eligible_at <= now()
      AND candidates.attempts < 3
    ORDER BY candidates.eligible_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING requests.id, requests.project_id, requests.signup_id,
            requests.user_id, requests.anonymous_id, requests.attempts;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reap: expired leases settle as unknown_outcome, terminal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_project_feedback_request_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reaped integer := 0;
BEGIN
  UPDATE public.project_feedback_requests AS requests
  SET state = 'unknown_outcome',
      lease_owner = NULL,
      lease_expires_at = NULL,
      failure_code = 'lease_expired',
      settled_at = now(),
      updated_at = now()
  WHERE requests.state = 'leased'
    AND requests.lease_expires_at < now();

  GET DIAGNOSTICS v_reaped = ROW_COUNT;
  RETURN v_reaped;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Settle: only the leaseholder, only from leased
-- ---------------------------------------------------------------------------

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
  SET state = p_state,
      lease_owner = NULL,
      lease_expires_at = NULL,
      provider_message_id = COALESCE(p_provider_message_id, requests.provider_message_id),
      failure_code = p_failure_code,
      settled_at = CASE WHEN p_state = 'queued' THEN NULL ELSE now() END,
      updated_at = now()
  WHERE requests.id = p_id
    AND requests.state = 'leased'
    AND requests.lease_owner = p_worker_id
  RETURNING requests.state INTO v_state;

  -- A superseded settlement (lease already reaped or re-owned) is visible
  -- to the caller rather than raising.
  IF v_state IS NULL THEN
    SELECT requests.state INTO v_state
    FROM public.project_feedback_requests AS requests
    WHERE requests.id = p_id;
  END IF;

  RETURN COALESCE(v_state, 'missing');
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: service_role only, matching the architecture audit gate
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.enqueue_project_feedback_requests(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_project_feedback_requests(uuid, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_project_feedback_requests(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_feedback_requests(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.reap_project_feedback_request_leases()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_project_feedback_request_leases()
  TO service_role;

REVOKE ALL ON FUNCTION public.settle_project_feedback_request(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_project_feedback_request(uuid, text, text, text, text)
  TO service_role;
