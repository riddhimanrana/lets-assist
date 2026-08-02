-- Keep partner-club semester standing as a current projection over an
-- append-only, replay-safe lifecycle stream.

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
  v_existing_event plugin_data.csf_partner_club_term_events%ROWTYPE;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_idempotency_key text;
  v_changed boolean;
BEGIN
  IF p_status NOT IN ('pending', 'active', 'inactive', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'Choose a valid partner-club semester standing.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A partner-club standing reason is required.';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'A partner-club standing request identifier is required.';
  END IF;
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  v_idempotency_key := 'standing-request:' || p_correlation_id::text;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_set_partner_club_term_status:'
        || p_organization_id::text || ':' || p_partner_club_term_id::text,
      0
    )
  );

  SELECT event.*
  INTO v_existing_event
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_event.partner_club_term_id <> p_partner_club_term_id
      OR v_existing_event.next_workflow_status IS DISTINCT FROM p_status
      OR v_existing_event.reason IS DISTINCT FROM v_reason
      OR v_existing_event.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'That partner-club standing request identifier is already bound to a different change.';
    END IF;

    RETURN jsonb_build_object(
      'partnerClubTermId', p_partner_club_term_id,
      'previousStatus', v_existing_event.previous_workflow_status,
      'status', v_existing_event.next_workflow_status,
      'correlationId', p_correlation_id,
      'changed', coalesce((v_existing_event.metadata ->> 'changed')::boolean, true),
      'idempotent', true
    );
  END IF;

  SELECT record.*
  INTO v_record
  FROM plugin_data.csf_partner_club_terms AS record
  JOIN plugin_data.csf_partner_clubs AS club
    ON club.organization_id = record.organization_id
   AND club.id = record.partner_club_id
  WHERE record.organization_id = p_organization_id
    AND record.id = p_partner_club_term_id
  FOR UPDATE OF record;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner-club semester record not found.';
  END IF;

  v_changed := v_record.workflow_status IS DISTINCT FROM p_status;

  IF v_changed THEN
    UPDATE plugin_data.csf_partner_club_terms
    SET workflow_status = p_status, updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_record.id;
  END IF;

  INSERT INTO plugin_data.csf_partner_club_term_events (
    organization_id,
    partner_club_term_id,
    event_type,
    previous_workflow_status,
    next_workflow_status,
    actor_user_id,
    reason,
    occurred_at,
    metadata,
    idempotency_key,
    correlation_id
  ) VALUES (
    p_organization_id,
    v_record.id,
    CASE WHEN p_status = 'archived' THEN 'archived' ELSE 'standing_changed' END,
    v_record.workflow_status,
    p_status,
    p_actor_user_id,
    v_reason,
    v_now,
    jsonb_build_object(
      'changed', v_changed,
      'requestId', p_correlation_id,
      'partnerClubId', v_record.partner_club_id,
      'termId', v_record.term_id
    ),
    v_idempotency_key,
    p_correlation_id
  );

  IF v_changed THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id, term_id,
      before_data, after_data, correlation_id, source_type, source_id, reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, 'partner_club.term_status_update',
      'csf_partner_club_terms', v_record.id, v_record.term_id,
      jsonb_build_object('status', v_record.workflow_status),
      jsonb_build_object('status', p_status, 'reason', v_reason),
      p_correlation_id, 'officer_decision', v_record.partner_club_id::text,
      CASE p_status
        WHEN 'active' THEN 'partner_club_term_approved'
        WHEN 'inactive' THEN 'partner_club_term_suspended'
        WHEN 'rejected' THEN 'partner_club_term_rejected'
        WHEN 'archived' THEN 'partner_club_term_expired'
        ELSE 'partner_club_term_pending'
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'partnerClubTermId', v_record.id,
    'previousStatus', v_record.workflow_status,
    'status', p_status,
    'correlationId', p_correlation_id,
    'changed', v_changed,
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
) IS 'Service-only, permission-checked, replay-safe partner-club semester standing transition whose current projection, immutable lifecycle receipt, and staff audit commit atomically.';

COMMIT;
