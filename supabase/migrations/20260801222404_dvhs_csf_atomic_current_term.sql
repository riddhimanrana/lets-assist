-- Select exactly one current CSF semester per organization. The current-term
-- swap and its audit receipt are one database transaction, so callers can
-- never observe a cleared organization without the requested replacement.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_current_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target plugin_data.csf_terms%ROWTYPE;
  v_previous_current_term_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF p_organization_id IS NULL OR p_term_id IS NULL THEN
    RAISE EXCEPTION 'CSF semester not found in this organization.';
  END IF;
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_cohorts_terms'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF semesters.';
  END IF;

  -- Every current-term writer that uses this public server operation takes the
  -- same tenant lock before reading any semester row. This serializes two
  -- simultaneous selections for one organization without blocking another.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_set_current_term:' || p_organization_id::text,
      0
    )
  );

  SELECT term.*
  INTO v_target
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester not found in this organization.';
  END IF;
  IF v_target.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived CSF semesters cannot become current.';
  END IF;

  IF v_target.is_current THEN
    RETURN jsonb_build_object(
      'termId', v_target.id,
      'previousCurrentTermId', v_target.id,
      'correlationId', NULL,
      'idempotent', true
    );
  END IF;

  SELECT term.id
  INTO v_previous_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.id
  LIMIT 1
  FOR UPDATE;

  UPDATE plugin_data.csf_terms
  SET is_current = false,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND is_current = true
    AND id <> p_term_id;

  UPDATE plugin_data.csf_terms
  SET is_current = true,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term.set_current',
    'csf_terms',
    p_term_id,
    p_term_id,
    jsonb_build_object(
      'previousCurrentTermId', v_previous_current_term_id,
      'requestedTermWasCurrent', false
    ),
    jsonb_build_object(
      'currentTermId', p_term_id,
      'previousCurrentTermId', v_previous_current_term_id,
      'isCurrent', true
    ),
    v_correlation_id,
    'staff_action',
    p_term_id::text,
    'current_term_selected'
  );

  RETURN jsonb_build_object(
    'termId', p_term_id,
    'previousCurrentTermId', v_previous_current_term_id,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_current_term(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_current_term(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_set_current_term(uuid, uuid, uuid)
  IS 'Server-only, organization-serialized current-semester selection with same-transaction immutable audit history; rejects missing, cross-tenant, closed, and archived targets.';

COMMIT;
