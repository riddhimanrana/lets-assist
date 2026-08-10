-- Give authorized CSF settings operators a one-time, audited way to acknowledge
-- durable webhook-quarantine evidence. This never retries, sends, suppresses, or
-- rewrites provider evidence; it only closes the human triage item.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_communication_webhook_quarantine(
  p_organization_id uuid,
  p_quarantine_id uuid,
  p_resolution_note text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quarantine plugin_data.csf_communication_webhook_quarantine%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_resolution_note, '')), '');
  v_identity text;
  v_original_correlation_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Authorization comes before target lookup so a service-path caller cannot
  -- probe whether another tenant has a quarantined provider envelope.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_settings'
  ) THEN
    RAISE EXCEPTION 'Not authorized to resolve CSF communication quarantine items.';
  END IF;
  IF p_quarantine_id IS NULL OR p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Quarantine resolution identity and correlation are required.';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 10 THEN
    RAISE EXCEPTION 'Explain the quarantine resolution in at least ten characters.';
  END IF;
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Quarantine resolution notes must be 500 characters or fewer.';
  END IF;

  SELECT quarantine.*
  INTO v_quarantine
  FROM plugin_data.csf_communication_webhook_quarantine AS quarantine
  WHERE quarantine.id = p_quarantine_id
    AND (
      quarantine.organization_id = p_organization_id
      OR (
        quarantine.organization_id IS NULL
        AND quarantine.claimed_organization_id = p_organization_id
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Communication quarantine item was not found.';
  END IF;

  v_identity := 'user:' || p_actor_user_id::text;
  IF v_quarantine.resolved_at IS NOT NULL THEN
    IF v_quarantine.resolved_by IS NOT DISTINCT FROM p_actor_user_id
      AND v_quarantine.resolved_by_identity = v_identity
      AND v_quarantine.resolution_note = v_note
    THEN
      SELECT audit.correlation_id
      INTO v_original_correlation_id
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.actor_user_id = p_actor_user_id
        AND audit.action = 'communication.webhook_quarantine.resolved'
        AND audit.target_type = 'csf_communication_webhook_quarantine'
        AND audit.target_id = p_quarantine_id
        AND audit.after_data->>'resolutionNote' = v_note
      ORDER BY audit.created_at DESC
      LIMIT 1;
      IF v_original_correlation_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'quarantineId', p_quarantine_id,
          'status', 'resolved',
          'correlationId', v_original_correlation_id,
          'idempotentReplay', true
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'This communication quarantine item has already been resolved.'
      USING DETAIL = 'CSF_QUARANTINE_ALREADY_RESOLVED';
  END IF;

  UPDATE plugin_data.csf_communication_webhook_quarantine
  SET resolved_at = v_now,
      resolved_by = p_actor_user_id,
      resolved_by_identity = v_identity,
      resolution_note = v_note
  WHERE id = p_quarantine_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'communication.webhook_quarantine.resolved',
    'csf_communication_webhook_quarantine',
    p_quarantine_id,
    jsonb_build_object(
      'resolved', false,
      'reasonCode', v_quarantine.reason_code,
      'occurrenceCount', v_quarantine.occurrence_count
    ),
    jsonb_build_object(
      'resolved', true,
      'reasonCode', v_quarantine.reason_code,
      'occurrenceCount', v_quarantine.occurrence_count,
      'resolutionNote', v_note
    ),
    p_correlation_id,
    'communications_recovery',
    p_quarantine_id::text,
    'webhook_quarantine_triaged'
  );

  RETURN jsonb_build_object(
    'quarantineId', p_quarantine_id,
    'status', 'resolved',
    'correlationId', p_correlation_id,
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_communication_webhook_quarantine(
  uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_communication_webhook_quarantine(
  uuid, uuid, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_resolve_communication_webhook_quarantine(
  uuid, uuid, text, uuid, uuid
) IS
  'One-time, manage_settings-authorized acknowledgement of a tenant-routed durable webhook-quarantine item. Actual organization routing wins over an untrusted claimed tenant. Records an immutable audit receipt and never sends, retries, suppresses, or rewrites provider evidence.';

NOTIFY pgrst, 'reload schema';

COMMIT;
