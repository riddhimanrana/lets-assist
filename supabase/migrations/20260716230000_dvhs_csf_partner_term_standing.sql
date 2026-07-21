-- Change one partner club's semester standing without rewriting its historical
-- approvals or separating the audit event from the operational update.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_partner_club_term_status(
  p_organization_id uuid,
  p_partner_club_term_id uuid,
  p_status text,
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
  v_record plugin_data.csf_partner_club_terms%ROWTYPE;
  v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
  v_now timestamptz := now();
BEGIN
  IF p_status NOT IN ('pending', 'active', 'inactive', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'Choose a valid partner-club semester standing.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A partner-club standing reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A partner-club standing actor is required.';
  END IF;

  SELECT record.*
  INTO v_record
  FROM plugin_data.csf_partner_club_terms AS record
  WHERE record.organization_id = p_organization_id
    AND record.id = p_partner_club_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner-club semester record not found.';
  END IF;

  IF v_record.workflow_status = p_status THEN
    RETURN jsonb_build_object(
      'partnerClubTermId', v_record.id,
      'status', p_status,
      'correlationId', v_correlation_id,
      'idempotent', true
    );
  END IF;

  UPDATE plugin_data.csf_partner_club_terms
  SET workflow_status = p_status, updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_record.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'partner_club.term_status_update',
    'csf_partner_club_terms', v_record.id, v_record.term_id,
    jsonb_build_object('status', v_record.workflow_status),
    jsonb_build_object('status', p_status, 'reason', p_reason),
    v_correlation_id, 'officer_decision', v_record.partner_club_id::text,
    CASE p_status
      WHEN 'active' THEN 'partner_club_term_approved'
      WHEN 'inactive' THEN 'partner_club_term_suspended'
      WHEN 'rejected' THEN 'partner_club_term_rejected'
      WHEN 'archived' THEN 'partner_club_term_expired'
      ELSE 'partner_club_term_pending'
    END
  );

  RETURN jsonb_build_object(
    'partnerClubTermId', v_record.id,
    'previousStatus', v_record.workflow_status,
    'status', p_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_term_status(
  uuid, uuid, text, text, uuid, uuid
) IS 'Server-only atomic partner-club semester standing transition with immutable audit history.';

COMMIT;
