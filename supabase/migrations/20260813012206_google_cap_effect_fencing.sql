-- Fence Google CAP Auth mutations behind the live receipt claim. A worker must
-- atomically revalidate the indexed Google identity owner and transition its
-- receipt to effect_started before calling the Supabase Auth Admin API.
-- effect_started is deliberately not reclaimable: an HTTP outcome can be
-- ambiguous, so allowing another worker to overtake it could let the stale
-- request overwrite newer security state.

BEGIN;

ALTER TABLE private.google_cap_event_receipts
  DROP CONSTRAINT google_cap_event_receipts_status_check,
  DROP CONSTRAINT google_cap_event_receipts_claim_check;

ALTER TABLE private.google_cap_event_receipts
  ADD CONSTRAINT google_cap_event_receipts_status_check
    CHECK (status IN ('processing', 'effect_started', 'completed', 'failed')),
  ADD CONSTRAINT google_cap_event_receipts_claim_check
    CHECK (
      (
        status = 'processing'
        AND claim_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND completed_at IS NULL
      )
      OR (
        status = 'effect_started'
        AND claim_token IS NOT NULL
        AND lease_expires_at IS NULL
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
    );

DROP INDEX private.google_cap_event_receipts_processing_subject_uidx;

CREATE UNIQUE INDEX google_cap_event_receipts_processing_subject_uidx
  ON private.google_cap_event_receipts (subject_hash)
  WHERE status IN ('processing', 'effect_started');

CREATE OR REPLACE FUNCTION public.claim_google_cap_event(
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_jti_hash, 0)
  );

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

    IF v_receipt.status = 'effect_started'
       OR (
         v_receipt.status = 'processing'
         AND v_receipt.lease_expires_at > pg_catalog.clock_timestamp()
       ) THEN
      RETURN QUERY SELECT
        v_receipt.id,
        'in_progress'::text,
        NULL::uuid,
        v_receipt.attempt_count,
        v_receipt.resolved_user_id;
      RETURN;
    END IF;
  END IF;

  SELECT
      pg_catalog.count(*),
      (pg_catalog.array_agg(matches.user_id))[1]
    INTO v_match_count, v_user_id
  FROM (
    SELECT DISTINCT identity_row.user_id
    FROM auth.identities AS identity_row
    WHERE identity_row.provider = 'google'
      AND identity_row.provider_id = p_google_subject
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

CREATE FUNCTION public.begin_google_cap_event_effect(
  p_receipt_id uuid,
  p_claim_token uuid,
  p_google_subject text
)
RETURNS TABLE (
  decision text,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt private.google_cap_event_receipts%ROWTYPE;
  v_user_id uuid;
  v_match_count integer;
BEGIN
  IF p_receipt_id IS NULL
     OR p_claim_token IS NULL
     OR p_google_subject IS NULL
     OR p_google_subject <> pg_catalog.btrim(p_google_subject)
     OR pg_catalog.char_length(p_google_subject) NOT BETWEEN 1 AND 255
     OR p_google_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid Google CAP effect coordinates'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_receipt
  FROM private.google_cap_event_receipts AS receipt
  WHERE receipt.id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_receipt.status <> 'processing'
     OR v_receipt.claim_token <> p_claim_token
     OR v_receipt.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT
      pg_catalog.count(*),
      (pg_catalog.array_agg(matches.user_id))[1]
    INTO v_match_count, v_user_id
  FROM (
    SELECT DISTINCT identity_row.user_id
    FROM auth.identities AS identity_row
    WHERE identity_row.provider = 'google'
      AND identity_row.provider_id = p_google_subject
    LIMIT 2
  ) AS matches;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'Google CAP subject maps to multiple local users'
      USING ERRCODE = '23514';
  END IF;

  IF v_user_id IS NULL THEN
    UPDATE private.google_cap_event_receipts
    SET status = 'failed',
        claim_token = NULL,
        lease_expires_at = NULL,
        safe_outcome = 'no_local_user',
        action_count = 0,
        error_count = 1,
        completed_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_receipt.id;

    RETURN QUERY SELECT 'no_local_user'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_receipt.resolved_user_id IS DISTINCT FROM v_user_id THEN
    UPDATE private.google_cap_event_receipts
    SET status = 'failed',
        claim_token = NULL,
        lease_expires_at = NULL,
        safe_outcome = 'identity_changed',
        action_count = 0,
        error_count = 1,
        completed_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_receipt.id;

    RETURN QUERY SELECT 'identity_changed'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE private.google_cap_event_receipts
  SET status = 'effect_started',
      lease_expires_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_receipt.id
    AND status = 'processing'
    AND claim_token = p_claim_token
    AND lease_expires_at > pg_catalog.clock_timestamp();

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'execute'::text, v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_google_cap_event(
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

  UPDATE private.google_cap_event_receipts AS receipt
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
  WHERE receipt.id = p_receipt_id
    AND receipt.status IN ('processing', 'effect_started')
    AND receipt.claim_token = p_claim_token
    AND (
      NOT p_succeeded
      OR receipt.status = 'effect_started'
      OR receipt.event_type NOT IN (
        'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
        'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
        'https://schemas.openid.net/secevent/oauth/event-type/token-revoked',
        'https://schemas.openid.net/secevent/risc/event-type/account-disabled',
        'https://schemas.openid.net/secevent/risc/event-type/account-enabled',
        'https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required'
      )
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_google_cap_event_effect(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_google_cap_event_effect(
  uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.claim_google_cap_event(
  text, text, text, text, timestamptz, text
) IS
  'Service-only Google CAP claim. Resolves Google identities through the indexed provider/provider_id coordinate and never reclaims an Auth effect whose outcome may be ambiguous.';
COMMENT ON FUNCTION public.begin_google_cap_event_effect(
  uuid, uuid, text
) IS
  'Service-only effect fence. Locks the live claim, revalidates indexed Google identity ownership, and makes takeover impossible before the Auth Admin mutation.';
COMMENT ON FUNCTION public.finish_google_cap_event(
  uuid, uuid, boolean, text, integer, integer
) IS
  'Service-only settlement. Actionable successful events must first hold the durable effect-started fence.';

COMMIT;
