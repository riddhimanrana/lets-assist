-- Keep optional activity dates consistent across creation, editing and publication.
-- Existing action wrappers retain authorization, locks and request receipts.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_activity_locked_impl(p_organization_id uuid, p_activity_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable activity request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_term_id IS NULL THEN RAISE EXCEPTION 'Activity and semester are required.'; END IF;
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Activity payload must be an object.'; END IF;

  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.update'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  IF v_before.status IN ('closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Closed, cancelled, or archived activities cannot be edited.';
  END IF;
  IF v_before.status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'Published external-signup activities require a signup URL.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities in a closed or archived semester cannot be edited.';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_linked_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects AS project
    WHERE project.organization_id = p_organization_id AND project.id = v_linked_project_id
  ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET term_id = p_term_id,
      cohort_id = p_cohort_id,
      title = v_title,
      body = coalesce(nullif(p_activity ->> 'body', ''), v_title),
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      location = nullif(p_activity ->> 'location', ''),
      signup_url = CASE
        WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
        ELSE nullif(p_activity ->> 'signupUrl', '')
      END,
      contact_email = nullif(p_activity ->> 'contactEmail', ''),
      point_value = coalesce((p_activity ->> 'pointValue')::numeric, 0),
      point_type = coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive'),
      point_cap = nullif(p_activity ->> 'pointCap', '')::numeric,
      signup_mode = v_signup_mode,
      requires_point_submission = coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
      evidence_policy = coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
      source_organization = nullif(p_activity ->> 'sourceOrganization', ''),
      linked_project_id = v_linked_project_id,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.update',
    'csf_opportunities', p_activity_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'title', v_before.title, 'status', v_before.status, 'termId', v_before.term_id,
      'cohortId', v_before.cohort_id, 'linkedProjectId', v_before.linked_project_id
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_after.title, 'status', v_after.status, 'termId', v_after.term_id,
      'cohortId', v_after.cohort_id, 'linkedProjectId', v_after.linked_project_id
    ),
    p_request_id, 'activity_updated'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_after.id,
    'status', v_after.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$function$;


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
    OR p_status NOT IN ('published', 'closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Invalid activity status.';
  END IF;
  IF p_status = 'cancelled' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  IF p_status = 'published' THEN
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
      'status', p_status,
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
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF p_status = 'published'
    AND v_before.term_id IS NULL THEN
    RAISE EXCEPTION 'A semester is required before publishing.';
  END IF;

  IF p_status = 'published' AND v_before.ends_at IS NOT NULL AND v_before.starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
  IF p_status = 'published' AND v_before.starts_at IS NOT NULL AND v_before.ends_at IS NOT NULL AND v_before.ends_at < v_before.starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;

  IF p_status = 'published' THEN
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

  IF p_status = 'published'
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
  SET status = p_status,
      published_at = CASE
        WHEN p_status = 'published' THEN coalesce(published_at, v_now)
        ELSE published_at
      END,
      closed_at = CASE
        WHEN p_status = 'closed' THEN v_now
        WHEN p_status = 'published' THEN NULL
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


REVOKE ALL ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid,uuid,text,text,uuid,uuid) TO postgres;

COMMIT;
