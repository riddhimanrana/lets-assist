-- Make Google Cross-Account Protection (RISC) delivery replay-safe and
-- bounded at the database boundary. Google may redeliver the same Security
-- Event Token, and SETs intentionally do not expire. We therefore retain only
-- cryptographic coordinates and aggregate outcomes: never the raw token,
-- Google subject, email, or provider payload.

BEGIN;

CREATE TABLE private.google_cap_event_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jti_hash text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  subject_hash text NOT NULL,
  event_type text NOT NULL,
  issued_at timestamptz NOT NULL,
  resolved_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'processing',
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 1,
  lease_expires_at timestamptz,
  safe_outcome text,
  action_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT google_cap_event_receipts_jti_hash_check
    CHECK (jti_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT google_cap_event_receipts_token_hash_check
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT google_cap_event_receipts_subject_hash_check
    CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT google_cap_event_receipts_event_type_check
    CHECK (
      event_type = btrim(event_type)
      AND char_length(event_type) BETWEEN 1 AND 255
      AND event_type LIKE 'https://schemas.openid.net/secevent/%'
    ),
  CONSTRAINT google_cap_event_receipts_status_check
    CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT google_cap_event_receipts_claim_check
    CHECK (
      (
        status = 'processing'
        AND claim_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'completed'
        AND claim_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NOT NULL
      )
      OR (
        status = 'failed'
        AND claim_token IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NULL
      )
    ),
  CONSTRAINT google_cap_event_receipts_attempt_count_check
    CHECK (attempt_count BETWEEN 1 AND 100),
  CONSTRAINT google_cap_event_receipts_safe_outcome_check
    CHECK (
      safe_outcome IS NULL
      OR (
        char_length(safe_outcome) BETWEEN 1 AND 64
        AND safe_outcome ~ '^[a-z][a-z0-9_]*$'
      )
    ),
  CONSTRAINT google_cap_event_receipts_action_count_check
    CHECK (action_count BETWEEN 0 AND 100),
  CONSTRAINT google_cap_event_receipts_error_count_check
    CHECK (error_count BETWEEN 0 AND 100)
);

COMMENT ON TABLE private.google_cap_event_receipts IS
  'Redacted durable Google CAP SET receipts. Hash-only identity coordinates make duplicate delivery replay-safe without retaining tokens, subjects, email addresses, or payloads.';
COMMENT ON COLUMN private.google_cap_event_receipts.jti_hash IS
  'SHA-256 of issuer + NUL + the SET jti; the raw stream identifier is never stored.';
COMMENT ON COLUMN private.google_cap_event_receipts.token_hash IS
  'SHA-256 of the exact signed compact token; binds a jti replay to identical signed bytes.';
COMMENT ON COLUMN private.google_cap_event_receipts.subject_hash IS
  'SHA-256 of issuer + NUL + the Google subject; the raw provider subject is never stored.';
COMMENT ON COLUMN private.google_cap_event_receipts.safe_outcome IS
  'Bounded platform-owned outcome code only; raw provider, auth, or database errors are never persisted.';

CREATE INDEX google_cap_event_receipts_status_lease_idx
  ON private.google_cap_event_receipts (status, lease_expires_at)
  WHERE status = 'processing';

-- Different SETs for one Google identity must not mutate auth state in
-- parallel. A partial unique index turns a concurrent claim into a retryable
-- database failure while still permitting complete event history.
CREATE UNIQUE INDEX google_cap_event_receipts_processing_subject_uidx
  ON private.google_cap_event_receipts (subject_hash)
  WHERE status = 'processing';

ALTER TABLE private.google_cap_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.google_cap_event_receipts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.google_cap_event_receipts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_google_cap_event(
  p_jti_hash text,
  p_token_hash text,
  p_subject_hash text,
  p_event_type text,
  p_issued_at timestamptz,
  p_google_subject text
)
RETURNS TABLE (
  receipt_id uuid,
  decision text,
  claim_token uuid,
  attempt_count integer,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt private.google_cap_event_receipts%ROWTYPE;
  v_claim_token uuid;
  v_user_id uuid;
  v_match_count integer;
BEGIN
  IF p_jti_hash IS NULL
     OR p_jti_hash !~ '^[a-f0-9]{64}$'
     OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_subject_hash IS NULL
     OR p_subject_hash !~ '^[a-f0-9]{64}$'
     OR p_event_type IS NULL
     OR p_event_type <> pg_catalog.btrim(p_event_type)
     OR pg_catalog.char_length(p_event_type) NOT BETWEEN 1 AND 255
     OR p_event_type NOT LIKE 'https://schemas.openid.net/secevent/%'
     OR p_issued_at IS NULL
     OR p_issued_at < timestamptz '2000-01-01 00:00:00+00'
     OR p_issued_at > pg_catalog.clock_timestamp() + interval '5 minutes'
     OR p_google_subject IS NULL
     OR p_google_subject <> pg_catalog.btrim(p_google_subject)
     OR pg_catalog.char_length(p_google_subject) NOT BETWEEN 1 AND 255
     OR p_google_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid Google CAP event coordinates'
      USING ERRCODE = '22023';
  END IF;

  -- jti is unique to the Google event stream. The advisory lock closes the
  -- lookup/insert race without persisting the raw jti as a lock coordinate.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_jti_hash, 0)
  );

  -- An abandoned lease cannot block all future events for the identity. If
  -- the old worker later attempts settlement, its claim token no longer owns
  -- the receipt and settlement fails closed.
  UPDATE private.google_cap_event_receipts
  SET status = 'failed',
      claim_token = NULL,
      lease_expires_at = NULL,
      safe_outcome = 'lease_expired',
      action_count = 0,
      error_count = 1,
      completed_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE subject_hash = p_subject_hash
    AND status = 'processing'
    AND lease_expires_at <= pg_catalog.clock_timestamp()
    AND jti_hash <> p_jti_hash;

  SELECT *
    INTO v_receipt
  FROM private.google_cap_event_receipts
  WHERE jti_hash = p_jti_hash
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.token_hash <> p_token_hash
       OR v_receipt.subject_hash <> p_subject_hash
       OR v_receipt.event_type <> p_event_type
       OR v_receipt.issued_at <> p_issued_at THEN
      RAISE EXCEPTION 'Google CAP jti is already bound to another signed event'
        USING ERRCODE = '22023';
    END IF;

    IF v_receipt.status = 'completed' THEN
      RETURN QUERY SELECT
        v_receipt.id,
        'replayed'::text,
        NULL::uuid,
        v_receipt.attempt_count,
        v_receipt.resolved_user_id;
      RETURN;
    END IF;

    IF v_receipt.status = 'processing'
       AND v_receipt.lease_expires_at > pg_catalog.clock_timestamp() THEN
      RETURN QUERY SELECT
        v_receipt.id,
        'in_progress'::text,
        NULL::uuid,
        v_receipt.attempt_count,
        v_receipt.resolved_user_id;
      RETURN;
    END IF;
  END IF;

  -- Supabase stores the provider's stable Google `sub` as provider_id. The
  -- identity_data fallback covers historical rows without scanning the Auth
  -- Admin API page-by-page. Resolve the current owner for every execution
  -- lease: identities can be linked, unlinked, or reassigned after a failed
  -- attempt, and a receipt must never keep acting on that stale mapping.
  SELECT
      pg_catalog.count(*),
      (pg_catalog.array_agg(matches.user_id))[1]
    INTO v_match_count, v_user_id
  FROM (
    SELECT DISTINCT identity_row.user_id
    FROM auth.identities AS identity_row
    WHERE identity_row.provider = 'google'
      AND (
        identity_row.provider_id::text = p_google_subject
        OR identity_row.identity_data ->> 'sub' = p_google_subject
      )
    LIMIT 2
  ) AS matches;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'Google CAP subject maps to multiple local users'
      USING ERRCODE = '23514';
  END IF;

  IF v_receipt.id IS NOT NULL THEN
    v_claim_token := gen_random_uuid();
    UPDATE private.google_cap_event_receipts AS receipt
    SET status = 'processing',
        claim_token = v_claim_token,
        attempt_count = CASE
          WHEN receipt.attempt_count < 100 THEN receipt.attempt_count + 1
          ELSE 100
        END,
        lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
        resolved_user_id = v_user_id,
        safe_outcome = NULL,
        action_count = 0,
        error_count = 0,
        completed_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE receipt.id = v_receipt.id
    RETURNING * INTO v_receipt;

    RETURN QUERY SELECT
      v_receipt.id,
      'execute'::text,
      v_claim_token,
      v_receipt.attempt_count,
      v_receipt.resolved_user_id;
    RETURN;
  END IF;

  v_claim_token := gen_random_uuid();
  INSERT INTO private.google_cap_event_receipts (
    jti_hash,
    token_hash,
    subject_hash,
    event_type,
    issued_at,
    resolved_user_id,
    status,
    claim_token,
    attempt_count,
    lease_expires_at
  ) VALUES (
    p_jti_hash,
    p_token_hash,
    p_subject_hash,
    p_event_type,
    p_issued_at,
    v_user_id,
    'processing',
    v_claim_token,
    1,
    pg_catalog.clock_timestamp() + interval '5 minutes'
  )
  RETURNING * INTO v_receipt;

  RETURN QUERY SELECT
    v_receipt.id,
    'execute'::text,
    v_claim_token,
    v_receipt.attempt_count,
    v_receipt.resolved_user_id;
END;
$$;

COMMENT ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) IS
  'Service-only Google CAP SET claim. Binds one hashed jti to identical signed coordinates, resolves the Google subject through indexed auth identity data without persisting it, and returns an expiring execution lease or replay state.';

CREATE FUNCTION public.finish_google_cap_event(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_succeeded boolean,
  p_safe_outcome text,
  p_action_count integer,
  p_error_count integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_receipt_id IS NULL
     OR p_claim_token IS NULL
     OR p_succeeded IS NULL
     OR p_safe_outcome IS NULL
     OR pg_catalog.char_length(p_safe_outcome) NOT BETWEEN 1 AND 64
     OR p_safe_outcome !~ '^[a-z][a-z0-9_]*$'
     OR p_action_count IS NULL
     OR p_action_count NOT BETWEEN 0 AND 100
     OR p_error_count IS NULL
     OR p_error_count NOT BETWEEN 0 AND 100
     OR (p_succeeded AND p_error_count <> 0) THEN
    RAISE EXCEPTION 'invalid Google CAP settlement'
      USING ERRCODE = '22023';
  END IF;

  UPDATE private.google_cap_event_receipts
  SET status = CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END,
      claim_token = NULL,
      lease_expires_at = NULL,
      safe_outcome = p_safe_outcome,
      action_count = p_action_count,
      error_count = p_error_count,
      completed_at = CASE
        WHEN p_succeeded THEN pg_catalog.clock_timestamp()
        ELSE NULL
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_receipt_id
    AND status = 'processing'
    AND claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

COMMENT ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) IS
  'Service-only settlement for a claimed Google CAP SET. Accepts aggregate bounded outcome codes and counters only; raw provider or user data cannot enter the receipt.';

REVOKE ALL ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) TO service_role;

COMMIT;
