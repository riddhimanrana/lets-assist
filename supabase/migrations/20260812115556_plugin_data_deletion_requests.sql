-- Durable service-only request/receipt boundary for permanent organization
-- plugin-data deletion. Plugin hooks may call external providers and therefore
-- cannot share a PostgreSQL transaction with this receipt.
--
-- Ordering contract:
--   1. atomically claim one organization/plugin/request/actor execution;
--   2. run the idempotent hook outside PostgreSQL;
--   3. durably finalize the hook outcome;
--   4. attempt audit logging, then attach that independent outcome.
--
-- A receipt left in `processing` has an ambiguous outcome after a process
-- crash. It is never automatically reclaimed: replay reports the durable
-- processing state and requires reconciliation. Only an explicitly reported
-- `retryable_failed` hook outcome can run again with a fresh claim token.

CREATE TABLE private.plugin_data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL,
  plugin_key text NOT NULL,
  actor_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  claim_token uuid,
  attempt_count integer NOT NULL DEFAULT 1,
  safe_error_code text,
  audit_status text NOT NULL DEFAULT 'pending',
  audit_event_id uuid,
  audit_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  audit_recorded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plugin_data_deletion_requests_plugin_key_check
    CHECK (
      plugin_key = btrim(plugin_key)
      AND char_length(plugin_key) BETWEEN 1 AND 100
    ),
  CONSTRAINT plugin_data_deletion_requests_fingerprint_check
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT plugin_data_deletion_requests_status_check
    CHECK (status IN (
      'processing',
      'retryable_failed',
      'succeeded',
      'manual_reconciliation'
    )),
  CONSTRAINT plugin_data_deletion_requests_claim_check
    CHECK (
      (status = 'processing' AND claim_token IS NOT NULL)
      OR (status <> 'processing' AND claim_token IS NULL)
    ),
  CONSTRAINT plugin_data_deletion_requests_attempt_count_check
    CHECK (attempt_count BETWEEN 1 AND 100),
  CONSTRAINT plugin_data_deletion_requests_safe_error_check
    CHECK (
      safe_error_code IS NULL
      OR (
        char_length(safe_error_code) BETWEEN 1 AND 64
        AND safe_error_code ~ '^[a-z0-9_]+$'
      )
    ),
  CONSTRAINT plugin_data_deletion_requests_audit_status_check
    CHECK (audit_status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT plugin_data_deletion_requests_audit_error_check
    CHECK (
      audit_error_code IS NULL
      OR (
        char_length(audit_error_code) BETWEEN 1 AND 64
        AND audit_error_code ~ '^[a-z0-9_]+$'
      )
    )
);

COMMENT ON TABLE private.plugin_data_deletion_requests IS
  'Redacted durable receipts for service-orchestrated organization plugin-data deletion. Processing receipts are never automatically reclaimed.';
COMMENT ON COLUMN private.plugin_data_deletion_requests.request_key IS
  'Globally unique idempotency key; it cannot be rebound to another actor, organization, plugin, or request fingerprint.';
COMMENT ON COLUMN private.plugin_data_deletion_requests.request_fingerprint IS
  'SHA-256 digest of the exact organization/plugin/actor/confirmation scope; never stores confirmation text.';
COMMENT ON COLUMN private.plugin_data_deletion_requests.safe_error_code IS
  'Bounded platform-owned code only; raw plugin/provider errors are never persisted.';
COMMENT ON COLUMN private.plugin_data_deletion_requests.audit_status IS
  'Independent post-finalization audit outcome; audit failure never changes deletion status.';

CREATE UNIQUE INDEX plugin_data_deletion_requests_processing_scope_idx
  ON private.plugin_data_deletion_requests (organization_id, plugin_key)
  WHERE status = 'processing';

CREATE INDEX plugin_data_deletion_requests_scope_history_idx
  ON private.plugin_data_deletion_requests (
    organization_id,
    plugin_key,
    created_at DESC
  );

ALTER TABLE private.plugin_data_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.plugin_data_deletion_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.plugin_data_deletion_requests
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE private.plugin_data_deletion_requests
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_plugin_data_deletion_request(
  p_organization_id uuid,
  p_plugin_key text,
  p_request_key uuid,
  p_request_fingerprint text,
  p_actor_id uuid
)
RETURNS TABLE (
  request_id uuid,
  decision text,
  status text,
  claim_token uuid,
  attempt_count integer,
  safe_error_code text,
  audit_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request private.plugin_data_deletion_requests%ROWTYPE;
  v_new_claim uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_request_key IS NULL
     OR p_actor_id IS NULL
     OR p_plugin_key IS NULL
     OR p_plugin_key <> pg_catalog.btrim(p_plugin_key)
     OR pg_catalog.char_length(p_plugin_key) NOT BETWEEN 1 AND 100
     OR p_request_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid plugin data deletion request'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize both the globally unique key and the organization/plugin scope.
  -- The xact locks close the gap between lookup and insert without exposing
  -- raw scope values in a persistent lock table.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_key::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_plugin_key,
      0
    )
  );

  SELECT *
    INTO v_request
  FROM private.plugin_data_deletion_requests
  WHERE request_key = p_request_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_request.organization_id <> p_organization_id
       OR v_request.plugin_key <> p_plugin_key
       OR v_request.actor_id <> p_actor_id
       OR v_request.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'plugin data deletion request key scope mismatch'
        USING ERRCODE = '22023';
    END IF;

    IF v_request.status = 'retryable_failed' THEN
      IF EXISTS (
        SELECT 1
        FROM private.plugin_data_deletion_requests AS requests
        WHERE requests.organization_id = p_organization_id
          AND requests.plugin_key = p_plugin_key
          AND requests.status = 'processing'
          AND requests.id <> v_request.id
      ) THEN
        RAISE EXCEPTION
          'another plugin data deletion request is unresolved for this scope'
          USING ERRCODE = '55000';
      END IF;

      v_new_claim := pg_catalog.gen_random_uuid();

      UPDATE private.plugin_data_deletion_requests AS requests
      SET status = 'processing',
          claim_token = v_new_claim,
          attempt_count = requests.attempt_count + 1,
          safe_error_code = NULL,
          audit_status = 'pending',
          audit_event_id = NULL,
          audit_error_code = NULL,
          audit_recorded_at = NULL,
          attempt_started_at = pg_catalog.now(),
          completed_at = NULL,
          updated_at = pg_catalog.now()
      WHERE requests.id = v_request.id
        AND requests.status = 'retryable_failed'
        AND requests.attempt_count < 100
      RETURNING *
        INTO v_request;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'plugin data deletion retry limit reached'
          USING ERRCODE = '54000';
      END IF;

      RETURN QUERY SELECT
        v_request.id,
        'execute'::text,
        v_request.status,
        v_request.claim_token,
        v_request.attempt_count,
        v_request.safe_error_code,
        v_request.audit_status;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      v_request.id,
      CASE v_request.status
        WHEN 'processing' THEN 'in_progress'
        WHEN 'succeeded' THEN 'succeeded'
        ELSE 'manual_reconciliation'
      END::text,
      v_request.status,
      NULL::uuid,
      v_request.attempt_count,
      v_request.safe_error_code,
      v_request.audit_status;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.plugin_data_deletion_requests AS requests
    WHERE requests.organization_id = p_organization_id
      AND requests.plugin_key = p_plugin_key
      AND requests.status = 'processing'
  ) THEN
    RAISE EXCEPTION
      'another plugin data deletion request is unresolved for this scope'
      USING ERRCODE = '55000';
  END IF;

  v_new_claim := pg_catalog.gen_random_uuid();
  INSERT INTO private.plugin_data_deletion_requests (
    request_key,
    organization_id,
    plugin_key,
    actor_id,
    request_fingerprint,
    claim_token
  )
  VALUES (
    p_request_key,
    p_organization_id,
    p_plugin_key,
    p_actor_id,
    p_request_fingerprint,
    v_new_claim
  )
  RETURNING *
    INTO v_request;

  RETURN QUERY SELECT
    v_request.id,
    'execute'::text,
    v_request.status,
    v_request.claim_token,
    v_request.attempt_count,
    v_request.safe_error_code,
    v_request.audit_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_plugin_data_deletion_request(
  p_request_id uuid,
  p_claim_token uuid,
  p_status text,
  p_safe_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_request_id IS NULL
     OR p_claim_token IS NULL
     OR p_status NOT IN (
       'succeeded',
       'retryable_failed',
       'manual_reconciliation'
     )
     OR (
       p_status = 'succeeded'
       AND p_safe_error_code IS NOT NULL
     )
     OR (
       p_status <> 'succeeded'
       AND (
         p_safe_error_code IS NULL
         OR pg_catalog.char_length(p_safe_error_code) NOT BETWEEN 1 AND 64
         OR p_safe_error_code !~ '^[a-z0-9_]+$'
       )
     ) THEN
    RAISE EXCEPTION 'invalid plugin data deletion completion'
      USING ERRCODE = '22023';
  END IF;

  UPDATE private.plugin_data_deletion_requests
  SET status = p_status,
      claim_token = NULL,
      safe_error_code = p_safe_error_code,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_request_id
    AND status = 'processing'
    AND claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_plugin_data_deletion_audit_result(
  p_request_id uuid,
  p_audit_status text,
  p_audit_event_id uuid DEFAULT NULL,
  p_audit_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_request_id IS NULL
     OR p_audit_status NOT IN ('succeeded', 'failed')
     OR (
       p_audit_status = 'succeeded'
       AND (p_audit_event_id IS NULL OR p_audit_error_code IS NOT NULL)
     )
     OR (
       p_audit_status = 'failed'
       AND (
         p_audit_event_id IS NOT NULL
         OR p_audit_error_code IS NULL
         OR pg_catalog.char_length(p_audit_error_code) NOT BETWEEN 1 AND 64
         OR p_audit_error_code !~ '^[a-z0-9_]+$'
       )
     ) THEN
    RAISE EXCEPTION 'invalid plugin data deletion audit result'
      USING ERRCODE = '22023';
  END IF;

  UPDATE private.plugin_data_deletion_requests
  SET audit_status = p_audit_status,
      audit_event_id = p_audit_event_id,
      audit_error_code = p_audit_error_code,
      audit_recorded_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE id = p_request_id
    AND status IN (
      'retryable_failed',
      'succeeded',
      'manual_reconciliation'
    )
    AND audit_status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_plugin_data_deletion_request(
  uuid,
  text,
  uuid,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_plugin_data_deletion_request(
  uuid,
  text,
  uuid,
  text,
  uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.complete_plugin_data_deletion_request(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_plugin_data_deletion_request(
  uuid,
  uuid,
  text,
  text
) TO service_role;

REVOKE ALL ON FUNCTION public.record_plugin_data_deletion_audit_result(
  uuid,
  text,
  uuid,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_plugin_data_deletion_audit_result(
  uuid,
  text,
  uuid,
  text
) TO service_role;

COMMENT ON FUNCTION public.begin_plugin_data_deletion_request(
  uuid,
  text,
  uuid,
  text,
  uuid
) IS
  'Service-only race-safe claim/replay boundary. Processing claims are never automatically reclaimed after ambiguous outcomes.';
COMMENT ON FUNCTION public.complete_plugin_data_deletion_request(
  uuid,
  uuid,
  text,
  text
) IS
  'Service-only compare-and-set finalization using the current attempt claim token.';
COMMENT ON FUNCTION public.record_plugin_data_deletion_audit_result(
  uuid,
  text,
  uuid,
  text
) IS
  'Service-only post-finalization audit outcome attachment; never changes deletion status.';
