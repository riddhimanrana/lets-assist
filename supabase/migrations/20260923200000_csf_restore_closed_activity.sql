-- Restore legacy closed activities through the audited lifecycle without publishing notices.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_locked_impl(p_organization_id uuid, p_activity_id uuid, p_status text, p_reason text, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_lock_term_id uuid;
  v_request jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
  v_target_status text := CASE WHEN p_status = 'restored' THEN 'published' ELSE p_status END;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_opportunities'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable activity request identifier is required.';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('published', 'restored', 'closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Invalid activity status.';
  END IF;
  IF p_status = 'cancelled' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  IF v_target_status = 'published' THEN
    SELECT activity.term_id
    INTO v_lock_term_id
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_activity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity was not found in this organization.';
    END IF;
    IF v_lock_term_id IS NULL THEN
      RAISE EXCEPTION 'A semester is required before publishing.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || v_lock_term_id::text,
        0
      )
    );
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', p_status,
    'reason', v_reason
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_atomic_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );
  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.status_change'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', v_target_status,
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.*
  INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id
    AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF activity was not found in this organization.';
  END IF;
  IF v_before.status = 'archived' THEN
    RAISE EXCEPTION 'Archived activities cannot be changed.';
  END IF;
  IF p_status = 'published' AND v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft activities can be published.';
  END IF;
  IF p_status = 'restored' AND v_before.status <> 'closed' THEN
    RAISE EXCEPTION 'Only closed activities can be restored.';
  END IF;
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF v_target_status = 'published'
    AND v_before.term_id IS NULL THEN
    RAISE EXCEPTION 'A semester is required before publishing.';
  END IF;

  IF v_target_status = 'published' AND v_before.ends_at IS NOT NULL AND v_before.starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_target_status = 'published' AND v_before.starts_at IS NOT NULL AND v_before.ends_at IS NOT NULL AND v_before.ends_at < v_before.starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;

  IF v_target_status = 'published' THEN
    IF v_before.term_id IS DISTINCT FROM v_lock_term_id THEN
      RAISE EXCEPTION 'CSF activity semester changed; refresh and try again.';
    END IF;

    SELECT term.*
    INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_before.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_term.lifecycle_status <> 'open' THEN
      RAISE EXCEPTION 'Activities cannot be published in a closed or archived semester.';
    END IF;
  END IF;

  IF v_target_status = 'published'
    AND v_before.signup_mode = 'lets_assist_project'
    AND NOT EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.organization_id = p_organization_id
        AND project.id = v_before.linked_project_id
    ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET status = v_target_status,
      published_at = CASE
        WHEN v_target_status = 'published' THEN coalesce(published_at, v_now)
        ELSE published_at
      END,
      closed_at = CASE
        WHEN p_status = 'closed' THEN v_now
        WHEN v_target_status = 'published' THEN NULL
        ELSE closed_at
      END,
      cancelled_at = CASE
        WHEN p_status = 'cancelled' THEN v_now
        ELSE cancelled_at
      END,
      cancellation_reason = CASE
        WHEN p_status = 'cancelled' THEN v_reason
        ELSE cancellation_reason
      END,
      archived_at = CASE
        WHEN p_status = 'archived' THEN v_now
        ELSE archived_at
      END,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_activity_id
  RETURNING *
  INTO v_after;

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
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'activity.status_change',
    'csf_opportunities',
    p_activity_id,
    v_after.term_id,
    pg_catalog.jsonb_build_object('status', v_before.status),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'status', v_after.status,
      'reason', v_reason
    ),
    p_request_id,
    CASE
      WHEN p_status = 'restored' THEN 'activity_restored'
      WHEN p_status = 'cancelled' THEN 'activity_cancelled'
      ELSE 'activity_status_changed'
    END
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status_with_email(
 p_organization_id uuid,p_activity_id uuid,p_status text,p_reason text,p_actor_user_id uuid,p_request_id uuid,p_email_requested boolean,p_email_topic jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;v_had_event boolean;
BEGIN
 IF p_status='restored' AND p_email_requested IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Restoring an activity cannot request another announcement.' USING ERRCODE='22023';
 END IF;
 IF p_email_requested IS NULL THEN RAISE EXCEPTION 'Choose whether to email this publication.'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
 SELECT EXISTS(SELECT 1 FROM plugin_data.csf_publication_events WHERE organization_id=p_organization_id AND source_kind='activity' AND source_id=p_activity_id AND event_key='') INTO v_had_event;
 v_result:=plugin_data.csf_set_activity_status(p_organization_id,p_activity_id,p_status,p_reason,p_actor_user_id,p_request_id);
 IF p_status='restored' THEN RETURN v_result; END IF;
 RETURN v_result||plugin_data.csf_capture_activity_email_intent(p_organization_id,p_activity_id,p_actor_user_id,p_request_id,p_email_requested,p_email_topic,
   NOT v_had_event AND coalesce((v_result->>'idempotent')::boolean,false)=false);
END; $$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_with_email(uuid,uuid,text,text,uuid,uuid,boolean,jsonb) TO service_role;

COMMIT;
