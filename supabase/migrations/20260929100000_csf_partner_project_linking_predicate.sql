-- CSF partner-project linking (contract v2 section 1.8, draft timestamp).
--
-- A CSF activity may link its own organization's project or a public,
-- published, uncancelled partner project. Linking grants metadata only;
-- attendance authorization is a separate check in the attendance projection.
-- The four owner-only activity implementations keep their signatures and V128
-- wrappers. They now lock the stored and requested projects before request,
-- semester, or CSF row locks, apply the predicate on create, on a link change,
-- and on publish or restore, clear links for other signup modes, and mark
-- organizer evidence stale when a link changes or the activity is cancelled or
-- archived. The evidence helper is defined by the attendance projection
-- migration (PL/pgSQL resolves it at call time).

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_project_is_linkable(
  p_organization_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = p_project_id
      AND p_organization_id IS NOT NULL
      AND (
        project.organization_id = p_organization_id
        OR (
          project.visibility = 'public'
          AND coalesce(project.workflow_status, 'published') = 'published'
          AND project.status IS DISTINCT FROM 'cancelled'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid) TO postgres;
COMMENT ON FUNCTION plugin_data.csf_project_is_linkable(uuid, uuid) IS
  'Partner metadata eligibility: the chapter''s own project, or a public, published, uncancelled project of any organizer. Grants no roster or attendance access.';

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity_locked_impl(p_organization_id uuid, p_term_id uuid, p_cohort_id uuid, p_activity jsonb, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_external_capacity text;
  v_signup_links jsonb;
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
  -- A stored link only exists for Let's Assist project signups.
  IF v_signup_mode <> 'lets_assist_project' THEN
    v_linked_project_id := NULL;
  END IF;
  IF v_status = 'published' AND v_signup_mode = 'external'
    AND nullif(pg_catalog.btrim(p_activity ->> 'signupUrl'), '') IS NULL THEN
    RAISE EXCEPTION 'External signup posts need a signup URL.';
  END IF;

  -- Versioned earning rules are optional; a payload without them keeps the
  -- legacy fixed award. With rules, the stored point value is the per-submission
  -- ceiling and the stored point type is the lead category.
  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  -- Project before request, semester, or CSF row locks (contract 1.9).
  IF v_linked_project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects AS project
    WHERE project.id = v_linked_project_id
    FOR KEY SHARE;
  END IF;
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
  IF v_linked_project_id IS NOT NULL
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, v_linked_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  INSERT INTO plugin_data.csf_opportunities (
    organization_id, term_id, cohort_id, title, body, starts_at, ends_at,
    location, signup_url, contact_email, point_value, point_type, point_cap,
    signup_mode, requires_point_submission, evidence_policy, source_organization,
    created_by_user_id, status, linked_project_id, published_at,
    earning_rules, earning_rules_version, external_capacity, signup_links
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
    v_point_value,
    v_point_type,
    nullif(p_activity ->> 'pointCap', '')::numeric,
    v_signup_mode,
    coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
    coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
    nullif(p_activity ->> 'sourceOrganization', ''),
    p_actor_user_id,
    v_status,
    v_linked_project_id,
    CASE WHEN v_status = 'published' THEN pg_catalog.now() ELSE NULL END,
    v_rules,
    1,
    v_external_capacity,
    v_signup_links
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
      'linkedProjectId', v_activity.linked_project_id,
      'earningRulesVersion', v_activity.earning_rules_version
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
$function$;

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
  v_rules_input jsonb := p_activity -> 'earningRules';
  v_normalized jsonb;
  v_rules jsonb;
  v_point_value numeric;
  v_point_type text;
  v_point_cap numeric;
  v_external_capacity text;
  v_signup_links jsonb;
  v_rules_version integer;
  v_stored_project_id uuid;
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
  -- A stored link only exists for Let's Assist project signups.
  IF v_signup_mode <> 'lets_assist_project' THEN
    v_linked_project_id := NULL;
  END IF;

  IF v_rules_input IS NOT NULL AND pg_catalog.jsonb_typeof(v_rules_input) <> 'null' THEN
    v_normalized := plugin_data.csf_normalize_earning_rules(v_rules_input);
    v_rules := v_normalized -> 'rules';
    v_point_value := (v_normalized ->> 'ceilingPoints')::numeric;
    v_point_type := v_normalized ->> 'ceilingPointType';
  ELSE
    v_rules := NULL;
    v_point_value := coalesce((p_activity ->> 'pointValue')::numeric, 0);
    v_point_type := coalesce(nullif(p_activity ->> 'pointType', ''), 'non_drive');
  END IF;
  v_point_cap := nullif(p_activity ->> 'pointCap', '')::numeric;
  v_external_capacity := nullif(pg_catalog.btrim(coalesce(p_activity ->> 'externalCapacity', '')), '');
  IF v_external_capacity IS NOT NULL AND pg_catalog.length(v_external_capacity) > 500 THEN
    RAISE EXCEPTION 'External volunteer capacity must be 500 characters or fewer.';
  END IF;
  v_signup_links := plugin_data.csf_normalize_signup_links(p_activity -> 'signupLinks');

  v_request := pg_catalog.jsonb_build_object(
    'activityId', p_activity_id,
    'termId', p_term_id,
    'cohortId', p_cohort_id,
    'activity', p_activity
  );
  -- Stored and requested projects before request, semester, or CSF row locks
  -- (contract 1.9). The V128 wrapper's staff-access lock serializes activity
  -- edits, so the stored link read here stays current.
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  PERFORM 1 FROM public.projects AS project
  WHERE project.id IN (v_stored_project_id, v_linked_project_id)
  ORDER BY project.id
  FOR KEY SHARE;
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
  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF v_linked_project_id IS NOT NULL
    AND v_linked_project_id IS DISTINCT FROM v_before.linked_project_id
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, v_linked_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  -- Any change to how points are earned starts a new rules version. Existing
  -- submissions keep the snapshot they were evaluated under.
  v_rules_version := CASE
    WHEN v_before.earning_rules IS DISTINCT FROM v_rules
      OR v_before.point_value IS DISTINCT FROM v_point_value::numeric(6,2)
      OR v_before.point_type IS DISTINCT FROM v_point_type
      OR v_before.point_cap IS DISTINCT FROM v_point_cap::numeric(6,2)
    THEN v_before.earning_rules_version + 1
    ELSE v_before.earning_rules_version
  END;

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
      point_value = v_point_value,
      point_type = v_point_type,
      point_cap = v_point_cap,
      signup_mode = v_signup_mode,
      requires_point_submission = coalesce((p_activity ->> 'requiresPointSubmission')::boolean, true),
      evidence_policy = coalesce(nullif(p_activity ->> 'evidencePolicy', ''), 'required'),
      source_organization = nullif(p_activity ->> 'sourceOrganization', ''),
      linked_project_id = v_linked_project_id,
      earning_rules = v_rules,
      earning_rules_version = v_rules_version,
      external_capacity = v_external_capacity,
      signup_links = v_signup_links,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  -- Organizer evidence for a project this activity no longer links is stale.
  IF v_after.linked_project_id IS DISTINCT FROM v_before.linked_project_id THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_relinked', v_after.linked_project_id
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.update',
    'csf_opportunities', p_activity_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'title', v_before.title, 'status', v_before.status, 'termId', v_before.term_id,
      'cohortId', v_before.cohort_id, 'linkedProjectId', v_before.linked_project_id,
      'earningRulesVersion', v_before.earning_rules_version
    ),
    pg_catalog.jsonb_build_object(
      'request', v_request,
      'title', v_after.title, 'status', v_after.status, 'termId', v_after.term_id,
      'cohortId', v_after.cohort_id, 'linkedProjectId', v_after.linked_project_id,
      'earningRulesVersion', v_after.earning_rules_version
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

CREATE OR REPLACE FUNCTION plugin_data.csf_link_activity_project_locked_impl(p_organization_id uuid, p_activity_id uuid, p_project_id uuid, p_actor_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_stored_project_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_opportunities') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF activities.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable project-link request identifier is required.'; END IF;
  IF p_activity_id IS NULL OR p_project_id IS NULL THEN RAISE EXCEPTION 'Activity and project are required.'; END IF;

  v_request := pg_catalog.jsonb_build_object('activityId', p_activity_id, 'projectId', p_project_id);
  -- Stored and requested projects before request or CSF row locks (1.9).
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  PERFORM 1 FROM public.projects AS project
  WHERE project.id IN (v_stored_project_id, p_project_id)
  ORDER BY project.id
  FOR KEY SHARE;
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
  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF p_project_id IS DISTINCT FROM v_before.linked_project_id
    AND NOT plugin_data.csf_project_is_linkable(p_organization_id, p_project_id) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET signup_mode = 'lets_assist_project',
      linked_project_id = p_project_id,
      signup_url = '/projects/' || p_project_id::text,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  IF v_after.linked_project_id IS DISTINCT FROM v_before.linked_project_id THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_relinked', v_after.linked_project_id
    );
  END IF;

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
  v_target_status text := CASE WHEN p_status = 'restored' THEN 'published' ELSE p_status END;
  v_stored_project_id uuid;
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

  -- Project before semester, request, or CSF row locks (contract 1.9).
  SELECT activity.linked_project_id INTO v_stored_project_id
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id;
  IF v_stored_project_id IS NOT NULL THEN
    PERFORM 1 FROM public.projects AS project
    WHERE project.id = v_stored_project_id
    FOR KEY SHARE;
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

  IF v_before.linked_project_id IS DISTINCT FROM v_stored_project_id THEN
    RAISE EXCEPTION 'CSF activity changed; refresh and try again.';
  END IF;
  IF v_target_status = 'published'
    AND v_before.signup_mode = 'lets_assist_project'
    AND (v_before.linked_project_id IS NULL
      OR NOT plugin_data.csf_project_is_linkable(p_organization_id, v_before.linked_project_id)) THEN
    RAISE EXCEPTION 'Linked project is not available to this organization.';
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

  IF v_target_status IN ('cancelled', 'archived') THEN
    PERFORM plugin_data.csf_invalidate_activity_attendance_evidence(
      p_organization_id, p_activity_id, 'activity_unavailable', NULL
    );
  END IF;

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

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity_locked_impl(uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity_locked_impl(uuid, uuid, uuid, jsonb, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid, uuid, uuid, uuid, jsonb, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity_locked_impl(uuid, uuid, uuid, uuid, jsonb, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_link_activity_project_locked_impl(uuid, uuid, uuid, uuid, uuid) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status_locked_impl(uuid, uuid, text, text, uuid, uuid) TO postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
