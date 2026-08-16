-- Durable, server-only Google OAuth attempt ledger.
--
-- The previous design kept the whole authorization request in one browser
-- cookie (`lets_assist_google_oauth_state`) holding a single nonce. Every
-- `/api/calendar/google/connect` call overwrote that one cookie, so a second
-- Calendar/Drive/CSF attempt -- another tab, an impatient re-click, or a
-- Picker reconnect started while a Calendar connect was still open --
-- invalidated the first. The older callback then failed `nonce_mismatch`,
-- which the callback collapsed to `error=invalid_state`; because state
-- verification had failed there was also no verified `return_to`, so the
-- browser landed on `/account/calendar` regardless of which surface started
-- the flow. That is exactly the reported hosted Development symptom.
--
-- This ledger replaces that single cookie with one durable server-side record
-- per attempt:
--   * the state Google echoes back is an opaque high-entropy secret; only its
--     SHA-256 digest is stored, so reading the ledger cannot forge a callback;
--   * the browser cookie is attempt-specific and is also stored only as a
--     digest, so concurrent attempts cannot overwrite one another while the
--     cookie still carries CSRF proof;
--   * the PKCE verifier is stored encrypted at rest by the application and is
--     released only to the one claimant, for the token exchange;
--   * claim/finalize are atomic and epoch-fenced, so a duplicated callback can
--     never re-exchange an authorization code. A duplicate is told whether the
--     original is still in flight or already settled, and an abandoned claim
--     recovers through a bounded processing lease rather than stranding the
--     attempt.
--
-- Nothing here is client callable. The table is server-only (RLS forced, no
-- policies) and every function is granted to service_role alone.
--
-- `app_private` is deliberately absent from PostgREST's exposed schemas, so
-- the application cannot reach these functions through `supabase.rpc`. The
-- three thin `public` wrappers at the end exist only to give the service-role
-- client a callable surface; they carry no client grant.

BEGIN;

CREATE TABLE IF NOT EXISTS app_private.google_oauth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Opaque lookup handle carried in the state Google echoes back. It names the
  -- attempt-specific cookie and is useless without the state secret.
  attempt_ref text NOT NULL UNIQUE
    CHECK (attempt_ref ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- SHA-256 (base64url) of the state secret. The secret itself is never stored.
  state_digest text NOT NULL UNIQUE
    CHECK (state_digest ~ '^[A-Za-z0-9_-]{43}$'),
  -- SHA-256 (base64url) of the attempt-specific cookie value.
  cookie_digest text NOT NULL
    CHECK (cookie_digest ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SHA-256 (base64url) of the signed-in session identifier at issue time. The
  -- browser never receives this value; a callback presented under a different
  -- session fails closed.
  session_digest text NOT NULL
    CHECK (session_digest ~ '^[A-Za-z0-9_-]{43}$'),
  purpose text NOT NULL CHECK (purpose IN (
    'personal_calendar',
    'personal_sheets',
    'organization_calendar',
    'organization_sheets',
    'csf_import'
  )),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text CHECK (plugin_key IS NULL OR plugin_key = 'dvhs-csf'),
  requested_capability text CHECK (
    requested_capability IS NULL
    OR requested_capability IN (
      'import_applications',
      'import_members',
      'import_meetings',
      'import_partner_clubs'
    )
  ),
  -- Already resolved against the purpose-specific allowlist before insert.
  return_to text NOT NULL CHECK (
    return_to ~ '^/[^/\\]' AND length(return_to) <= 512
  ),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  -- Application-encrypted PKCE verifier, or the explicit post-settlement
  -- tombstone. Never a plaintext credential at rest.
  code_verifier_encrypted text NOT NULL CHECK (
    code_verifier_encrypted = 'consumed'
    OR length(code_verifier_encrypted) BETWEEN 16 AND 4096
  ),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'succeeded', 'failed', 'unknown')),
  -- Set the moment the authorization code is presented to Google. An
  -- authorization code is single-use, so once this is set the attempt can
  -- never be retried: a later callback must reconcile, not re-exchange.
  code_exchanged_at timestamptz,
  -- Incremented on every claim. A worker whose lease lapsed cannot finalize
  -- over its successor.
  claim_epoch integer NOT NULL DEFAULT 0 CHECK (claim_epoch >= 0),
  -- Bounded processing lease. While it holds, a duplicated callback is told
  -- the original is still in flight instead of starting a second exchange.
  lease_expires_at timestamptz,
  -- Bounded diagnostic code. Never a provider payload or message.
  outcome_code text CHECK (outcome_code ~ '^[a-z0-9_]{1,64}$'),
  connection_id uuid REFERENCES public.user_calendar_connections(id) ON DELETE SET NULL,
  -- Short, correlation-safe code shown to the operator and written to logs.
  correlation_id text NOT NULL CHECK (correlation_id ~ '^[A-Z0-9]{10}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  finalized_at timestamptz,
  CONSTRAINT google_oauth_attempts_binding_check CHECK (
    CASE purpose
      WHEN 'csf_import' THEN
        organization_id IS NOT NULL
        AND plugin_key = 'dvhs-csf'
        AND requested_capability IS NOT NULL
      WHEN 'organization_calendar' THEN
        organization_id IS NOT NULL AND plugin_key IS NULL AND requested_capability IS NULL
      WHEN 'organization_sheets' THEN
        organization_id IS NOT NULL AND plugin_key IS NULL AND requested_capability IS NULL
      ELSE
        organization_id IS NULL AND plugin_key IS NULL AND requested_capability IS NULL
    END
  ),
  CONSTRAINT google_oauth_attempts_lifecycle_check CHECK (
    CASE status
      WHEN 'pending' THEN
        claim_epoch = 0
        AND claimed_at IS NULL
        AND lease_expires_at IS NULL
        AND finalized_at IS NULL
        AND outcome_code IS NULL
      WHEN 'claimed' THEN
        claim_epoch > 0
        AND claimed_at IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND finalized_at IS NULL
        AND outcome_code IS NULL
      ELSE
        claim_epoch > 0
        AND claimed_at IS NOT NULL
        AND finalized_at IS NOT NULL
        AND outcome_code IS NOT NULL
    END
  ),
  -- An unknown outcome is only reachable after the code was actually spent.
  CONSTRAINT google_oauth_attempts_unknown_requires_exchange_check CHECK (
    status <> 'unknown' OR code_exchanged_at IS NOT NULL
  ),
  -- A recorded success must name the durable connection it produced. Every
  -- success path in the callback persists one, so a NULL here would be a bug
  -- masquerading as a connected account.
  CONSTRAINT google_oauth_attempts_success_connection_check CHECK (
    (status = 'succeeded') = (connection_id IS NOT NULL)
  )
);

COMMENT ON TABLE app_private.google_oauth_attempts IS
  'Server-only Google OAuth authorization attempts. One row per connect click. Holds digests and an encrypted PKCE verifier, never a state secret, cookie value, provider payload, or access/refresh token.';

COMMENT ON COLUMN app_private.google_oauth_attempts.claim_epoch IS
  'Monotonic claim counter. finalize only applies when the caller presents the current epoch, so a worker whose lease lapsed cannot overwrite its successor.';

COMMENT ON COLUMN app_private.google_oauth_attempts.lease_expires_at IS
  'Bounded processing lease for the current claim. While it holds a duplicate callback is in_progress; once it lapses the attempt is reclaimable rather than stranded.';

CREATE INDEX IF NOT EXISTS google_oauth_attempts_user_purpose_idx
  ON app_private.google_oauth_attempts (user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS google_oauth_attempts_expiry_idx
  ON app_private.google_oauth_attempts (expires_at)
  WHERE status IN ('pending', 'claimed');

ALTER TABLE app_private.google_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.google_oauth_attempts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE app_private.google_oauth_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_private.google_oauth_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- begin: record a pending attempt and sweep this user's dead rows.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.begin_google_oauth_attempt(
  p_attempt_ref text,
  p_state_digest text,
  p_cookie_digest text,
  p_user_id uuid,
  p_session_digest text,
  p_purpose text,
  p_organization_id uuid,
  p_plugin_key text,
  p_requested_capability text,
  p_return_to text,
  p_code_challenge text,
  p_code_verifier_encrypted text,
  p_correlation_id text,
  p_ttl_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt_id uuid;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 1800 THEN
    RAISE EXCEPTION 'Google OAuth attempt TTL is out of range';
  END IF;

  -- Bound the ledger without a scheduled job. An attempt that expired without
  -- a callback is worthless, and a settled one only has to outlive a
  -- duplicated callback long enough to answer it.
  DELETE FROM app_private.google_oauth_attempts
  WHERE user_id = p_user_id
    AND (
      (status = 'pending' AND expires_at < now() - interval '1 hour')
      OR (
        status = 'claimed'
        AND lease_expires_at < now() - interval '1 hour'
        AND expires_at < now() - interval '1 hour'
      )
      OR (status IN ('succeeded', 'failed') AND finalized_at < now() - interval '1 hour')
    );

  INSERT INTO app_private.google_oauth_attempts (
    attempt_ref,
    state_digest,
    cookie_digest,
    user_id,
    session_digest,
    purpose,
    organization_id,
    plugin_key,
    requested_capability,
    return_to,
    code_challenge,
    code_verifier_encrypted,
    correlation_id,
    expires_at
  )
  VALUES (
    p_attempt_ref,
    p_state_digest,
    p_cookie_digest,
    p_user_id,
    p_session_digest,
    p_purpose,
    p_organization_id,
    p_plugin_key,
    p_requested_capability,
    p_return_to,
    p_code_challenge,
    p_code_verifier_encrypted,
    p_correlation_id,
    now() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- claim: the exactly-once fence.
--
-- Verdicts:
--   claimed         this caller owns the exchange, and holds the lease
--   in_progress     an unexpired claim is still running; do nothing
--   already_settled a terminal outcome exists; replay it, never re-exchange
--   expired         the authorization window lapsed; settled as failed
--   unknown_attempt / cookie_mismatch / user_mismatch / session_mismatch
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.claim_google_oauth_attempt(
  p_state_digest text,
  p_cookie_digest text,
  p_user_id uuid,
  p_session_digest text,
  p_lease_seconds integer
)
RETURNS TABLE (
  verdict text,
  attempt_id uuid,
  claim_epoch integer,
  purpose text,
  organization_id uuid,
  plugin_key text,
  requested_capability text,
  return_to text,
  code_verifier_encrypted text,
  correlation_id text,
  recorded_status text,
  recorded_outcome_code text,
  recorded_connection_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_attempt app_private.google_oauth_attempts%ROWTYPE;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Google OAuth attempt lease is out of range';
  END IF;

  -- Serialize concurrent callbacks for the same attempt before deciding.
  SELECT * INTO v_attempt
  FROM app_private.google_oauth_attempts AS attempt
  WHERE attempt.state_digest = p_state_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    verdict := 'unknown_attempt';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Binding and return-path data are released only to the matching browser and
  -- signed-in principal, so a mismatch discloses nothing about the attempt.
  IF v_attempt.cookie_digest IS DISTINCT FROM p_cookie_digest THEN
    verdict := 'cookie_mismatch';
    correlation_id := v_attempt.correlation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.user_id IS DISTINCT FROM p_user_id THEN
    verdict := 'user_mismatch';
    correlation_id := v_attempt.correlation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.session_digest IS DISTINCT FROM p_session_digest THEN
    verdict := 'session_mismatch';
    correlation_id := v_attempt.correlation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.status IN ('succeeded', 'failed', 'unknown') THEN
    -- A duplicated or replayed callback after settlement. Never re-exchange;
    -- hand back the recorded result so the browser still lands correctly.
    verdict := 'already_settled';
    attempt_id := v_attempt.id;
    claim_epoch := v_attempt.claim_epoch;
    purpose := v_attempt.purpose;
    organization_id := v_attempt.organization_id;
    plugin_key := v_attempt.plugin_key;
    requested_capability := v_attempt.requested_capability;
    return_to := v_attempt.return_to;
    correlation_id := v_attempt.correlation_id;
    recorded_status := v_attempt.status;
    recorded_outcome_code := v_attempt.outcome_code;
    recorded_connection_id := v_attempt.connection_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.status = 'claimed' AND v_attempt.lease_expires_at > now() THEN
    -- The original exchange is still running. Duplicates wait rather than
    -- racing it, and the attempt is never deleted or stranded.
    verdict := 'in_progress';
    attempt_id := v_attempt.id;
    claim_epoch := v_attempt.claim_epoch;
    purpose := v_attempt.purpose;
    return_to := v_attempt.return_to;
    correlation_id := v_attempt.correlation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.expires_at <= now() THEN
    UPDATE app_private.google_oauth_attempts
    SET status = 'failed',
        outcome_code = 'expired_state',
        claim_epoch = greatest(v_attempt.claim_epoch, 1),
        claimed_at = coalesce(v_attempt.claimed_at, now()),
        lease_expires_at = NULL,
        finalized_at = now(),
        code_verifier_encrypted = 'consumed'
    WHERE id = v_attempt.id;

    verdict := 'expired';
    attempt_id := v_attempt.id;
    purpose := v_attempt.purpose;
    return_to := v_attempt.return_to;
    correlation_id := v_attempt.correlation_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_attempt.code_exchanged_at IS NOT NULL THEN
    -- The lease lapsed after the authorization code was already presented to
    -- Google. The code is spent, so re-exchanging it would fail and report a
    -- misleading error, and the credential save may or may not have landed.
    -- Settle as an explicit unknown outcome so the operator is told to recheck
    -- rather than being shown a false success or a false failure.
    UPDATE app_private.google_oauth_attempts
    SET status = 'unknown',
        outcome_code = 'connection_outcome_unknown',
        lease_expires_at = NULL,
        finalized_at = now(),
        code_verifier_encrypted = 'consumed'
    WHERE id = v_attempt.id;

    verdict := 'already_settled';
    attempt_id := v_attempt.id;
    purpose := v_attempt.purpose;
    organization_id := v_attempt.organization_id;
    plugin_key := v_attempt.plugin_key;
    requested_capability := v_attempt.requested_capability;
    return_to := v_attempt.return_to;
    correlation_id := v_attempt.correlation_id;
    recorded_status := 'unknown';
    recorded_outcome_code := 'connection_outcome_unknown';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Either the first claim, or recovery of a claim whose lease lapsed before
  -- the authorization code was ever presented, which is safe to retry.
  UPDATE app_private.google_oauth_attempts
  SET status = 'claimed',
      claim_epoch = v_attempt.claim_epoch + 1,
      claimed_at = coalesce(v_attempt.claimed_at, now()),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = v_attempt.id;

  verdict := 'claimed';
  attempt_id := v_attempt.id;
  claim_epoch := v_attempt.claim_epoch + 1;
  purpose := v_attempt.purpose;
  organization_id := v_attempt.organization_id;
  plugin_key := v_attempt.plugin_key;
  requested_capability := v_attempt.requested_capability;
  return_to := v_attempt.return_to;
  code_verifier_encrypted := v_attempt.code_verifier_encrypted;
  correlation_id := v_attempt.correlation_id;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- finalize: record the terminal outcome for the current claimant only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.finalize_google_oauth_attempt(
  p_attempt_id uuid,
  p_claim_epoch integer,
  p_status text,
  p_outcome_code text,
  p_connection_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Unsupported Google OAuth attempt outcome';
  END IF;

  IF p_status = 'succeeded' AND p_connection_id IS NULL THEN
    RAISE EXCEPTION 'A successful Google OAuth attempt must name its connection';
  END IF;

  UPDATE app_private.google_oauth_attempts
  SET status = p_status,
      outcome_code = p_outcome_code,
      connection_id = CASE WHEN p_status = 'succeeded' THEN p_connection_id ELSE NULL END,
      lease_expires_at = NULL,
      finalized_at = now(),
      -- The verifier has served its only purpose. Tombstone it so a settled
      -- row cannot leak PKCE material even if the ledger is read.
      code_verifier_encrypted = 'consumed'
  WHERE id = p_attempt_id
    AND status = 'claimed'
    AND claim_epoch = p_claim_epoch;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;


-- ---------------------------------------------------------------------------
-- mark_exchanged: record that the single-use authorization code was spent.
--
-- Called immediately before the token request. From this point the attempt is
-- never retryable, so a later callback reconciles instead of re-exchanging.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.mark_google_oauth_attempt_exchanged(
  p_attempt_id uuid,
  p_claim_epoch integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE app_private.google_oauth_attempts
  SET code_exchanged_at = coalesce(code_exchanged_at, now())
  WHERE id = p_attempt_id
    AND status = 'claimed'
    AND claim_epoch = p_claim_epoch;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION app_private.begin_google_oauth_attempt(
  text, text, text, uuid, text, text, uuid, text, text, text, text, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.begin_google_oauth_attempt(
  text, text, text, uuid, text, text, uuid, text, text, text, text, text, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION app_private.claim_google_oauth_attempt(text, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.claim_google_oauth_attempt(text, text, uuid, text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION app_private.finalize_google_oauth_attempt(uuid, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.finalize_google_oauth_attempt(uuid, integer, text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION app_private.mark_google_oauth_attempt_exchanged(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.mark_google_oauth_attempt_exchanged(uuid, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- PostgREST-callable wrappers.
--
-- `app_private` is intentionally outside PostgREST's exposed schemas, so the
-- service-role Supabase client cannot call the implementations above directly.
-- These wrappers are the only callable surface, and they are service_role-only:
-- no anon, authenticated, or PUBLIC grant exists, so no browser can reach them
-- even with a forged JWT role claim.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_google_oauth_attempt(
  p_attempt_ref text,
  p_state_digest text,
  p_cookie_digest text,
  p_user_id uuid,
  p_session_digest text,
  p_purpose text,
  p_organization_id uuid,
  p_plugin_key text,
  p_requested_capability text,
  p_return_to text,
  p_code_challenge text,
  p_code_verifier_encrypted text,
  p_correlation_id text,
  p_ttl_seconds integer
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app_private.begin_google_oauth_attempt(
    p_attempt_ref, p_state_digest, p_cookie_digest, p_user_id, p_session_digest,
    p_purpose, p_organization_id, p_plugin_key, p_requested_capability,
    p_return_to, p_code_challenge, p_code_verifier_encrypted, p_correlation_id,
    p_ttl_seconds
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_google_oauth_attempt(
  p_state_digest text,
  p_cookie_digest text,
  p_user_id uuid,
  p_session_digest text,
  p_lease_seconds integer
)
RETURNS TABLE (
  verdict text,
  attempt_id uuid,
  claim_epoch integer,
  purpose text,
  organization_id uuid,
  plugin_key text,
  requested_capability text,
  return_to text,
  code_verifier_encrypted text,
  correlation_id text,
  recorded_status text,
  recorded_outcome_code text,
  recorded_connection_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT *
  FROM app_private.claim_google_oauth_attempt(
    p_state_digest, p_cookie_digest, p_user_id, p_session_digest, p_lease_seconds
  );
$$;

CREATE OR REPLACE FUNCTION public.finalize_google_oauth_attempt(
  p_attempt_id uuid,
  p_claim_epoch integer,
  p_status text,
  p_outcome_code text,
  p_connection_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app_private.finalize_google_oauth_attempt(
    p_attempt_id, p_claim_epoch, p_status, p_outcome_code, p_connection_id
  );
$$;

CREATE OR REPLACE FUNCTION public.mark_google_oauth_attempt_exchanged(
  p_attempt_id uuid,
  p_claim_epoch integer
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app_private.mark_google_oauth_attempt_exchanged(p_attempt_id, p_claim_epoch);
$$;

REVOKE ALL ON FUNCTION public.mark_google_oauth_attempt_exchanged(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_google_oauth_attempt_exchanged(uuid, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_google_oauth_attempt(
  text, text, text, uuid, text, text, uuid, text, text, text, text, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_google_oauth_attempt(
  text, text, text, uuid, text, text, uuid, text, text, text, text, text, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_google_oauth_attempt(text, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_oauth_attempt(text, text, uuid, text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_google_oauth_attempt(uuid, integer, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_google_oauth_attempt(uuid, integer, text, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
