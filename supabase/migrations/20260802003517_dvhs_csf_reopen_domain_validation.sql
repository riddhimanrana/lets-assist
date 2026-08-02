-- Keep the transaction-local reopen authorization structurally bound to the
-- requested tenant, term, and closure without allowing the immediate foreign
-- key to replace the public reopen RPC's domain errors. Idempotent replays are
-- resolved by the base function before the authorization is needed; new
-- reopens lock and validate the active revision before inserting the ledger row.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_reopen_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_expected_closure_id uuid,
  p_expected_revision integer,
  p_reason_code text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_active_closure_id uuid;
  v_closure_revision integer;
  v_transaction_id bigint := pg_catalog.txid_current();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'reopen_term'
    ) THEN
    RAISE EXCEPTION 'Not authorized to reopen this CSF semester.';
  END IF;
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Semester reopen requires an actor and correlation ID.';
  END IF;
  IF p_expected_closure_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Semester reopen requires the expected close revision.';
  END IF;
  IF p_reason_code NOT IN (
    'data_correction', 'appeal_resolution', 'attendance_correction',
    'dues_correction', 'administrative_correction', 'other'
  ) THEN
    RAISE EXCEPTION 'Semester reopen reason code is invalid.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Semester reopen requires a reason of at least 10 characters.';
  END IF;

  -- A replay never reaches the evidence-restoration writes, so it does not
  -- need a transaction-local authorization. Lock the immutable event so the
  -- base function is guaranteed to take its replay/correlation-conflict path.
  PERFORM 1
  FROM plugin_data.csf_term_reopen_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.correlation_id = p_correlation_id
  FOR KEY SHARE;
  IF FOUND THEN
    RETURN plugin_data.csf_reopen_term_base(
      p_organization_id,
      p_term_id,
      p_expected_closure_id,
      p_expected_revision,
      p_reason_code,
      p_reason,
      p_actor_user_id,
      p_correlation_id
    );
  END IF;

  SELECT term.active_closure_id, term.closure_revision
  INTO v_active_closure_id, v_closure_revision
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
    AND term.lifecycle_status = 'closed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester is missing or is not closed.';
  END IF;
  IF v_active_closure_id IS DISTINCT FROM p_expected_closure_id
    OR v_closure_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'The semester close revision changed; refresh and try again.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_term_closures AS closure
  WHERE closure.organization_id = p_organization_id
    AND closure.term_id = p_term_id
    AND closure.id = p_expected_closure_id
    AND closure.revision = p_expected_revision
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active CSF semester closure snapshot is missing.';
  END IF;

  INSERT INTO plugin_data.csf_term_reopen_authorizations (
    transaction_id, organization_id, term_id, closure_id
  ) VALUES (
    v_transaction_id, p_organization_id, p_term_id, p_expected_closure_id
  );

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_reopen_closure_id',
    p_expected_closure_id::text,
    true
  );

  BEGIN
    v_result := plugin_data.csf_reopen_term_base(
      p_organization_id,
      p_term_id,
      p_expected_closure_id,
      p_expected_revision,
      p_reason_code,
      p_reason,
      p_actor_user_id,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
    WHERE reopen_auth.transaction_id = v_transaction_id
      AND reopen_auth.organization_id = p_organization_id
      AND reopen_auth.term_id = p_term_id
      AND reopen_auth.closure_id = p_expected_closure_id;
    PERFORM pg_catalog.set_config('plugin_data.csf_reopen_closure_id', '', true);
    RAISE;
  END;

  DELETE FROM plugin_data.csf_term_reopen_authorizations AS reopen_auth
  WHERE reopen_auth.transaction_id = v_transaction_id
    AND reopen_auth.organization_id = p_organization_id
    AND reopen_auth.term_id = p_term_id
    AND reopen_auth.closure_id = p_expected_closure_id;
  PERFORM pg_catalog.set_config('plugin_data.csf_reopen_closure_id', '', true);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_reopen_term(uuid, uuid, uuid, integer, text, text, uuid, uuid)
  IS 'Permission-checked semester reopen boundary that preserves domain validation before issuing a transaction-local evidence authorization.';

COMMIT;
