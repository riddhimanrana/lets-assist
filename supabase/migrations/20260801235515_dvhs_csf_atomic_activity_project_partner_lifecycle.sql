-- Make every CSF activity mutation and partner-club lifecycle change a
-- permission-checked, organization-scoped transaction. The browser request UUID
-- is the immutable audit correlation and replay receipt.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS csf_admin_audit_events_activity_partner_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action IN (
    'activity.create',
    'activity.update',
    'activity.status_change',
    'opportunity.link_project',
    'partner_club.archive',
    'partner_club.status_update'
  );

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_status text;
  v_title text;
  v_signup_mode text;
  v_linked_project_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
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
  IF pg_catalog.jsonb_typeof(p_activity) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Activity payload must be an object.';
  END IF;

  v_status := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'status'), ''), 'draft');
  v_title := nullif(pg_catalog.btrim(p_activity ->> 'title'), '');
  v_signup_mode := coalesce(nullif(pg_catalog.btrim(p_activity ->> 'signupMode'), ''), 'external');
  BEGIN
    v_linked_project_id := nullif(p_activity ->> 'linkedProjectId', '')::uuid;
    v_starts_at := nullif(p_activity ->> 'startsAt', '')::timestamptz;
    v_ends_at := nullif(p_activity ->> 'endsAt', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Activity dates and linked project must be valid.';
  END;

  IF p_term_id IS NULL THEN RAISE EXCEPTION 'A CSF semester is required.'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'New activities must be saved as draft or published.'; END IF;
  IF v_signup_mode NOT IN ('external', 'lets_assist_project', 'none') THEN RAISE EXCEPTION 'Choose a valid activity signup source.'; END IF;
  IF v_status = 'published' AND v_starts_at IS NULL THEN RAISE EXCEPTION 'A start date is required before publishing.'; END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF v_signup_mode = 'lets_assist_project' AND v_linked_project_id IS NULL THEN
    RAISE EXCEPTION 'A Let''s Assist project is required for this signup source.';
  END IF;
  IF v_status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'External signup posts need a signup URL.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
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
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.create'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', v_receipt.target_id,
      'status', v_receipt.after_data ->> 'status',
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester was not found in this organization.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities cannot be created in a closed or archived semester.';
  END IF;

  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    JOIN plugin_data.csf_cohort_terms AS cohort_term
      ON cohort_term.organization_id = cohort.organization_id
      AND cohort_term.cohort_id = cohort.id
      AND cohort_term.term_id = p_term_id
      AND cohort_term.status <> 'archived'
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'That semester is not active for the selected graduating class in this organization.';
  END IF;
  IF v_linked_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects AS project
    WHERE project.organization_id = p_organization_id AND project.id = v_linked_project_id
  ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  INSERT INTO plugin_data.csf_opportunities (
    organization_id, term_id, cohort_id, title, body, starts_at, ends_at,
    location, signup_url, contact_email, point_value, point_type, point_cap,
    signup_mode, requires_point_submission, evidence_policy, source_organization,
    created_by_user_id, status, linked_project_id, published_at
  ) VALUES (
    p_organization_id,
    p_term_id,
    p_cohort_id,
    v_title,
    coalesce(nullif(p_activity ->> 'body', ''), v_title),
    v_starts_at,
    v_ends_at,
    nullif(p_activity ->> 'location', ''),
    CASE
      WHEN v_signup_mode = 'lets_assist_project' THEN '/projects/' || v_linked_project_id::text
      ELSE nullif(p_activity ->> 'signupUrl', '')
    END,
    nullif(p_activity ->> 'contactEmail', ''),
    coalesce((p_activity ->> 'pointValue')::numeric, 0),
    coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive'),
    nullif(p_activity ->> 'pointCap', '')::numeric,
    v_signup_mode,
    coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
    coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
    nullif(p_activity ->> 'sourceOrganization', ''),
    p_actor_user_id,
    v_status,
    v_linked_project_id,
    CASE WHEN v_status = 'published' THEN pg_catalog.now() ELSE NULL END
  ) RETURNING * INTO v_activity;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.create',
    'csf_opportunities', v_activity.id, p_term_id,
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_activity.title,
      'status', v_activity.status,
      'cohortId', v_activity.cohort_id,
      'linkedProjectId', v_activity.linked_project_id
    ),
    p_request_id, 'activity_created'
  );

  RETURN pg_catalog.jsonb_build_object(
    'activityId', v_activity.id,
    'status', v_activity.status,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_activity(
  p_organization_id uuid,
  p_activity_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF v_before.status = 'published' AND v_starts_at IS NULL THEN RAISE EXCEPTION 'A start date is required for a published activity.'; END IF;
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
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status(
  p_organization_id uuid,
  p_activity_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable activity request identifier is required.'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('published', 'closed', 'cancelled', 'archived') THEN RAISE EXCEPTION 'Invalid activity status.'; END IF;
  IF p_status = 'cancelled' AND v_reason IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required.'; END IF;

  v_request := pg_catalog.jsonb_build_object('activityId', p_activity_id, 'status', p_status, 'reason', v_reason);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'activity.status_change'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That activity request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id, 'status', p_status,
      'correlationId', p_request_id, 'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  IF v_before.status = 'archived' THEN RAISE EXCEPTION 'Archived activities cannot be changed.'; END IF;
  IF p_status = 'published' AND v_before.status <> 'draft' THEN RAISE EXCEPTION 'Only draft activities can be published.'; END IF;
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF p_status = 'published' AND (v_before.term_id IS NULL OR v_before.starts_at IS NULL) THEN
    RAISE EXCEPTION 'A semester and start date are required before publishing.';
  END IF;
  IF p_status = 'published' AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_before.term_id
      AND term.lifecycle_status NOT IN ('closed', 'archived')
  ) THEN
    RAISE EXCEPTION 'Activities cannot be published in a closed or archived semester.';
  END IF;
  IF p_status = 'published' AND v_before.signup_mode = 'lets_assist_project' AND NOT EXISTS (
    SELECT 1 FROM public.projects AS project
    WHERE project.organization_id = p_organization_id AND project.id = v_before.linked_project_id
  ) THEN
    RAISE EXCEPTION 'Linked project was not found in this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET status = p_status,
      published_at = CASE WHEN p_status = 'published' THEN coalesce(published_at, v_now) ELSE published_at END,
      closed_at = CASE WHEN p_status = 'closed' THEN v_now WHEN p_status = 'published' THEN NULL ELSE closed_at END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN v_now ELSE cancelled_at END,
      cancellation_reason = CASE WHEN p_status = 'cancelled' THEN v_reason ELSE cancellation_reason END,
      archived_at = CASE WHEN p_status = 'archived' THEN v_now ELSE archived_at END,
      updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.status_change',
    'csf_opportunities', p_activity_id, v_after.term_id,
    pg_catalog.jsonb_build_object('status', v_before.status),
    pg_catalog.jsonb_build_object('request', v_request, 'status', v_after.status, 'reason', v_reason),
    p_request_id,
    CASE WHEN p_status = 'cancelled' THEN 'activity_cancelled' ELSE 'activity_status_changed' END
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id, 'status', v_after.status,
    'correlationId', p_request_id, 'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_link_activity_project(
  p_organization_id uuid,
  p_activity_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable project-link request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_project_id IS NULL THEN RAISE EXCEPTION 'Activity and project are required.'; END IF;

  v_request := pg_catalog.jsonb_build_object('activityId', p_activity_id, 'projectId', p_project_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'opportunity.link_project'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_opportunities'
      OR v_receipt.target_id IS DISTINCT FROM p_activity_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That project-link request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'activityId', p_activity_id, 'projectId', p_project_id,
      'correlationId', p_request_id, 'idempotent', true
    );
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity was not found in this organization.'; END IF;
  PERFORM 1 FROM public.projects AS project
  WHERE project.organization_id = p_organization_id AND project.id = p_project_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linked project was not found in this organization.'; END IF;

  UPDATE plugin_data.csf_opportunities
  SET signup_mode = 'lets_assist_project',
      linked_project_id = p_project_id,
      signup_url = '/projects/' || p_project_id::text,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'opportunity.link_project',
    'csf_opportunities', p_activity_id, v_after.term_id,
    pg_catalog.jsonb_build_object(
      'signupMode', v_before.signup_mode,
      'linkedProjectId', v_before.linked_project_id,
      'signupUrl', v_before.signup_url
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'signupMode', v_after.signup_mode,
      'linkedProjectId', v_after.linked_project_id,
      'signupUrl', v_after.signup_url
    ),
    p_request_id, 'activity_project_linked'
  );
  RETURN pg_catalog.jsonb_build_object(
    'activityId', p_activity_id, 'projectId', p_project_id,
    'correlationId', p_request_id, 'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_partner_club_status(
  p_organization_id uuid,
  p_partner_club_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_partner_clubs%ROWTYPE;
  v_after plugin_data.csf_partner_clubs%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_action text;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_partner_clubs') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable partner-club request identifier is required.'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive', 'archived') THEN RAISE EXCEPTION 'Invalid partner club status.'; END IF;
  v_action := CASE WHEN p_status = 'archived' THEN 'partner_club.archive' ELSE 'partner_club.status_update' END;
  v_request := pg_catalog.jsonb_build_object('partnerClubId', p_partner_club_id, 'status', p_status);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_atomic_request:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));
  SELECT audit.* INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM v_action
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_partner_clubs'
      OR v_receipt.target_id IS DISTINCT FROM p_partner_club_id
      OR (v_receipt.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That partner-club request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'partnerClubId', p_partner_club_id, 'status', p_status,
      'correlationId', p_request_id, 'idempotent', true
    );
  END IF;

  SELECT club.* INTO v_before
  FROM plugin_data.csf_partner_clubs AS club
  WHERE club.organization_id = p_organization_id AND club.id = p_partner_club_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partner club was not found in this organization.'; END IF;

  UPDATE plugin_data.csf_partner_clubs
  SET status = p_status, updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_partner_club_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_action, 'csf_partner_clubs', p_partner_club_id,
    pg_catalog.jsonb_build_object('status', v_before.status),
    pg_catalog.jsonb_build_object('request', v_request, 'status', v_after.status),
    p_request_id,
    CASE WHEN p_status = 'archived' THEN 'partner_club_archived' ELSE 'partner_club_status_changed' END
  );
  RETURN pg_catalog.jsonb_build_object(
    'partnerClubId', p_partner_club_id, 'status', v_after.status,
    'correlationId', p_request_id, 'idempotent', false
  );
END;
$$;

-- Remove the older service-only overloads so a privileged application caller
-- cannot bypass the new permission and replay checks by choosing an old shape.
DROP FUNCTION IF EXISTS plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid);

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_link_activity_project(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_link_activity_project(uuid, uuid, uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_status(uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_status(uuid, uuid, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid, uuid)
  IS 'Creates one tenant-scoped CSF activity and immutable replay receipt after rechecking manage_opportunities.';
COMMENT ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  IS 'Updates one tenant-scoped CSF activity and immutable replay receipt after rechecking manage_opportunities.';
COMMENT ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid, uuid)
  IS 'Transitions one tenant-scoped CSF activity and records the replay-safe audit receipt atomically.';
COMMENT ON FUNCTION plugin_data.csf_link_activity_project(uuid, uuid, uuid, uuid, uuid)
  IS 'Links an activity and public project only when both belong to the exact organization, with atomic audit.';
COMMENT ON FUNCTION plugin_data.csf_set_partner_club_status(uuid, uuid, text, uuid, uuid)
  IS 'Archives, deactivates, or restores one tenant-scoped partner club with replay-safe atomic audit.';

COMMIT;
