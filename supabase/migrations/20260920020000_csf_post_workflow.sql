-- Use the chapter mailbox for new campaigns. Preserve frozen payloads and receipts.
BEGIN;

ALTER TABLE plugin_data.csf_communication_campaigns
  DROP CONSTRAINT IF EXISTS csf_communication_campaigns_dispatch_identity_check;

ALTER TABLE plugin_data.csf_communication_campaigns
  ADD CONSTRAINT csf_communication_campaigns_dispatch_identity_check
    CHECK (
      content_hash IS NULL
      OR (
        (
          -- Recorded by campaigns finalized before 20260918000000.
          (sender_email = 'csf@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF')
          OR
          -- Preserve existing finalized campaigns.
          (sender_email = 'projects@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF (Let''s Assist)')
          OR (sender_email = 'dvhs-csf@notifications.lets-assist.com'
            AND sender_name = 'DVHS CSF')
        )
        AND reply_to_email = 'dvhighcsf@gmail.com'
        AND channel = 'email'
        AND nullif(btrim(body_text), '') IS NOT NULL
        AND body_text_hash IS NOT NULL
        AND audience_kind IS NOT NULL
        AND term_id IS NOT NULL
        AND created_by_identity IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION plugin_data.csf_campaign_platform_sender_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sender_email = 'csf@notifications.lets-assist.com'
    AND NEW.sender_name = 'DVHS CSF'
  THEN
    NEW.sender_email := 'dvhs-csf@notifications.lets-assist.com';
    NEW.sender_name := 'DVHS CSF';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_campaign_platform_sender_identity()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_campaign_platform_sender_identity() TO postgres;


CREATE FUNCTION plugin_data.csf_delete_activity(
  p_organization_id uuid, p_activity_id uuid, p_actor_user_id uuid, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM 1 FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = p_actor_user_id AND status = 'active'
  FOR SHARE;
  IF NOT FOUND OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text, 0));
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
  WHERE organization_id = p_organization_id AND correlation_id = p_request_id
  ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.deleted'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object('activityId', p_activity_id, 'status', 'deleted', 'idempotent', true);
  END IF;
  SELECT * INTO v_activity FROM plugin_data.csf_opportunities
  WHERE organization_id = p_organization_id AND id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.' USING ERRCODE = '22023';
  END IF;
  IF v_activity.linked_project_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM plugin_data.csf_opportunity_signups WHERE opportunity_id = p_activity_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions WHERE opportunity_id = p_activity_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_credit_records WHERE opportunity_id = p_activity_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_profile_activity_events WHERE opportunity_id = p_activity_id)
    OR EXISTS (SELECT 1 FROM plugin_data.csf_communication_campaigns WHERE source_activity_id = p_activity_id)
  THEN
    RAISE EXCEPTION 'This activity has participation, points, email history, or a linked project. Archive it to preserve those records.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM plugin_data.csf_opportunities WHERE organization_id = p_organization_id AND id = p_activity_id;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id, actor_user_id, action, target_type, target_id, term_id, before_data, after_data, correlation_id, reason_code)
  VALUES (p_organization_id, p_actor_user_id, 'activity.deleted', 'csf_opportunities', p_activity_id,
    v_activity.term_id, pg_catalog.to_jsonb(v_activity), '{"status":"deleted"}'::jsonb,
    p_request_id, 'unused_activity_deleted');
  RETURN pg_catalog.jsonb_build_object('activityId', p_activity_id, 'status', 'deleted', 'idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_delete_activity(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_delete_activity(uuid, uuid, uuid, uuid) TO service_role;

COMMIT;
