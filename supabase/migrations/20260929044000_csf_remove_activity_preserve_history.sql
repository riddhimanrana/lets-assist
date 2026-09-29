-- Remove activities from the catalog while retaining linked student and email history.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_delete_activity(
  p_organization_id uuid, p_activity_id uuid, p_actor_user_id uuid, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_retained boolean := false;
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
    RETURN pg_catalog.jsonb_build_object('activityId', p_activity_id, 'status', 'deleted', 'idempotent', true, 'historyRetained', coalesce((v_receipt.after_data->>'historyRetained')::boolean, false));
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
    v_retained := true;
    UPDATE plugin_data.csf_opportunities
    SET status = 'archived', archived_at = coalesce(archived_at, pg_catalog.now())
    WHERE organization_id = p_organization_id AND id = p_activity_id;
  ELSE
    DELETE FROM plugin_data.csf_opportunities WHERE organization_id = p_organization_id AND id = p_activity_id;
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events
    (organization_id, actor_user_id, action, target_type, target_id, term_id, before_data, after_data, correlation_id, reason_code)
  VALUES (p_organization_id, p_actor_user_id, 'activity.deleted', 'csf_opportunities', p_activity_id,
    v_activity.term_id, pg_catalog.to_jsonb(v_activity), pg_catalog.jsonb_build_object('status', 'deleted', 'historyRetained', v_retained),
    p_request_id, CASE WHEN v_retained THEN 'activity_removed_history_retained' ELSE 'unused_activity_deleted' END);
  RETURN pg_catalog.jsonb_build_object('activityId', p_activity_id, 'status', 'deleted', 'idempotent', false, 'historyRetained', v_retained);
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_delete_activity(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_delete_activity(uuid, uuid, uuid, uuid) TO service_role;


COMMIT;
