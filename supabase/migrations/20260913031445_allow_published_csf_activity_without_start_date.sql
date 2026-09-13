-- Published CSF activities may omit a start date. Keep every other activity
-- validation, authorization, idempotency, audit, and ownership rule unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity_locked_impl(
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
  IF v_ends_at IS NOT NULL AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'Add a start before giving the activity an end time.';
  END IF;
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

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_create_activity_locked_impl(
  uuid, uuid, uuid, jsonb, uuid, uuid
) IS 'Owner-only implementation for atomic CSF activity creation. Published activities may omit a start date; the service wrapper rechecks current staff authority under lock.';

COMMIT;
