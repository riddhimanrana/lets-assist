-- Complete the versioned semester policy and activity lifecycle used by the
-- rebuilt DVHS CSF workspace. All tables remain server-only in plugin_data.

BEGIN;

ALTER TABLE plugin_data.csf_opportunities
  ADD COLUMN IF NOT EXISTS cohort_id uuid,
  ADD COLUMN IF NOT EXISTS point_cap numeric(6,2),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Historical cancelled rows predate lifecycle timestamps and reasons. Keep
-- their original update time as the best available cancellation timestamp and
-- record that the reason was not captured instead of making the new invariant
-- reject an otherwise valid staged replay.
UPDATE plugin_data.csf_opportunities
SET cancelled_at = coalesce(cancelled_at, updated_at, created_at, now()),
    cancellation_reason = coalesce(
      nullif(btrim(cancellation_reason), ''),
      'Legacy record: cancellation reason was not captured.'
    )
WHERE status = 'cancelled';

ALTER TABLE plugin_data.csf_opportunities
  DROP CONSTRAINT IF EXISTS csf_opportunities_status_check,
  ADD CONSTRAINT csf_opportunities_status_check
    CHECK (status IN ('draft', 'published', 'closed', 'cancelled', 'archived')),
  ADD CONSTRAINT csf_opportunities_point_cap_check
    CHECK (point_cap IS NULL OR point_cap >= point_value),
  ADD CONSTRAINT csf_opportunities_cancellation_check
    CHECK (
      (status = 'cancelled' AND cancelled_at IS NOT NULL AND nullif(btrim(cancellation_reason), '') IS NOT NULL)
      OR status <> 'cancelled'
    );

ALTER TABLE plugin_data.csf_opportunities
  ADD CONSTRAINT csf_opportunities_id_organization_id_key UNIQUE (id, organization_id),
  ADD CONSTRAINT csf_opportunities_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE SET NULL (term_id),
  ADD CONSTRAINT csf_opportunities_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id) ON DELETE SET NULL (cohort_id);

CREATE INDEX csf_opportunities_org_term_lifecycle_idx
  ON plugin_data.csf_opportunities (organization_id, term_id, status, starts_at DESC);

CREATE OR REPLACE FUNCTION plugin_data.csf_update_term_policy_v2(
  p_organization_id uuid,
  p_term_id uuid,
  p_total_points_required numeric,
  p_max_drive_points numeric,
  p_max_points_per_activity numeric,
  p_required_meetings integer,
  p_allowed_absences integer,
  p_allow_point_carryover boolean,
  p_academic_rules jsonb,
  p_dues_required boolean,
  p_dues_amount numeric,
  p_dues_currency text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_before plugin_data.csf_term_policies%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived semester policy cannot be changed.';
  END IF;

  IF p_total_points_required < 0 OR p_max_drive_points < 0
    OR p_max_points_per_activity <= 0 OR p_required_meetings < 0
    OR p_allowed_absences < 0 OR p_dues_amount < 0 THEN
    RAISE EXCEPTION 'CSF semester requirements cannot be negative.';
  END IF;
  IF p_max_drive_points > p_total_points_required THEN
    RAISE EXCEPTION 'The drive-point cap cannot exceed the total point requirement.';
  END IF;
  IF p_required_meetings > 0 AND p_allowed_absences > p_required_meetings THEN
    RAISE EXCEPTION 'Allowed absences cannot exceed required meetings.';
  END IF;
  IF jsonb_typeof(p_academic_rules) <> 'object'
    OR coalesce((p_academic_rules->>'minimumListI')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'minimumListIAndII')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'minimumTotal')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'maximumCourses')::integer, 0) <= 0
    OR jsonb_typeof(coalesce(p_academic_rules->'disqualifyingGrades', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Academic rules are incomplete or invalid.';
  END IF;
  IF p_dues_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Dues currency must be a three-letter code.';
  END IF;

  SELECT policy.* INTO v_before
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id AND policy.term_id = p_term_id
  FOR UPDATE;

  INSERT INTO plugin_data.csf_term_policies (
    organization_id, term_id, policy_version, total_points_required,
    max_drive_points, max_points_per_activity, required_meetings,
    allowed_absences, allow_point_carryover, academic_rules,
    dues_required, dues_amount, dues_currency, created_by, updated_by, updated_at
  ) VALUES (
    p_organization_id, p_term_id, 1, p_total_points_required,
    p_max_drive_points, p_max_points_per_activity, p_required_meetings,
    p_allowed_absences, coalesce(p_allow_point_carryover, false), p_academic_rules,
    coalesce(p_dues_required, false), p_dues_amount, upper(p_dues_currency),
    p_actor_user_id, p_actor_user_id, v_now
  )
  ON CONFLICT (organization_id, term_id) DO UPDATE SET
    policy_version = plugin_data.csf_term_policies.policy_version + 1,
    total_points_required = EXCLUDED.total_points_required,
    max_drive_points = EXCLUDED.max_drive_points,
    max_points_per_activity = EXCLUDED.max_points_per_activity,
    required_meetings = EXCLUDED.required_meetings,
    allowed_absences = EXCLUDED.allowed_absences,
    allow_point_carryover = EXCLUDED.allow_point_carryover,
    academic_rules = EXCLUDED.academic_rules,
    dues_required = EXCLUDED.dues_required,
    dues_amount = EXCLUDED.dues_amount,
    dues_currency = EXCLUDED.dues_currency,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_policy;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term_policy.update',
    'csf_term_policies', v_policy.id, p_term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_policy), v_correlation_id, 'semester_policy_versioned'
  );

  RETURN jsonb_build_object(
    'policyId', v_policy.id,
    'policyVersion', v_policy.policy_version,
    'termCode', v_term.code,
    'termLabel', v_term.label,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_activity_status(
  p_organization_id uuid,
  p_activity_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF p_status NOT IN ('published', 'closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Invalid activity status.';
  END IF;
  IF p_status = 'cancelled' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity not found.'; END IF;
  IF v_before.status = 'archived' THEN RAISE EXCEPTION 'Archived activities cannot be changed.'; END IF;
  IF p_status = 'published' AND v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft activities can be published.';
  END IF;
  IF p_status IN ('closed', 'cancelled') AND v_before.status <> 'published' THEN
    RAISE EXCEPTION 'Only published activities can be closed or cancelled.';
  END IF;
  IF p_status = 'published' AND (v_before.term_id IS NULL OR v_before.starts_at IS NULL) THEN
    RAISE EXCEPTION 'A semester and start date are required before publishing.';
  END IF;
  IF p_status = 'published' AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_before.term_id
      AND term.lifecycle_status NOT IN ('closed', 'archived')
  ) THEN
    RAISE EXCEPTION 'Activities cannot be published in a closed or archived semester.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET status = p_status,
      published_at = CASE WHEN p_status = 'published' THEN coalesce(published_at, v_now) ELSE published_at END,
      closed_at = CASE WHEN p_status = 'closed' THEN v_now WHEN p_status = 'published' THEN NULL ELSE closed_at END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN v_now ELSE cancelled_at END,
      cancellation_reason = CASE WHEN p_status = 'cancelled' THEN btrim(p_reason) ELSE cancellation_reason END,
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
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'reason', nullif(btrim(p_reason), '')),
    v_correlation_id,
    CASE WHEN p_status = 'cancelled' THEN 'activity_cancelled' ELSE 'activity_status_changed' END
  );

  RETURN jsonb_build_object(
    'activityId', p_activity_id,
    'status', v_after.status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_activity(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_status text := coalesce(nullif(p_activity->>'status', ''), 'draft');
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF jsonb_typeof(p_activity) <> 'object' THEN RAISE EXCEPTION 'Activity payload must be an object.'; END IF;
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'New activities must be saved as draft or published.'; END IF;
  IF nullif(btrim(p_activity->>'title'), '') IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;
  IF v_status = 'published' AND nullif(p_activity->>'startsAt', '') IS NULL THEN
    RAISE EXCEPTION 'A start date is required before publishing.';
  END IF;
  IF p_term_id IS NULL THEN RAISE EXCEPTION 'A CSF semester is required.'; END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities cannot be created in a closed or archived semester.';
  END IF;

  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'CSF class audience not found.';
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
    btrim(p_activity->>'title'),
    coalesce(nullif(p_activity->>'body', ''), btrim(p_activity->>'title')),
    nullif(p_activity->>'startsAt', '')::timestamptz,
    nullif(p_activity->>'endsAt', '')::timestamptz,
    nullif(p_activity->>'location', ''),
    nullif(p_activity->>'signupUrl', ''),
    nullif(p_activity->>'contactEmail', ''),
    coalesce((p_activity->>'pointValue')::numeric, 0),
    coalesce(nullif(p_activity->>'pointType', ''), 'non_drive'),
    nullif(p_activity->>'pointCap', '')::numeric,
    coalesce(nullif(p_activity->>'signupMode', ''), 'external'),
    coalesce((p_activity->>'requiresPointSubmission')::boolean, true),
    coalesce(nullif(p_activity->>'evidencePolicy', ''), 'required'),
    nullif(p_activity->>'sourceOrganization', ''),
    p_actor_user_id,
    v_status,
    nullif(p_activity->>'linkedProjectId', '')::uuid,
    CASE WHEN v_status = 'published' THEN now() ELSE NULL END
  ) RETURNING * INTO v_activity;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.create',
    'csf_opportunities', v_activity.id, p_term_id,
    jsonb_build_object(
      'title', v_activity.title,
      'status', v_activity.status,
      'cohortId', v_activity.cohort_id,
      'pointValue', v_activity.point_value,
      'pointType', v_activity.point_type
    ),
    v_correlation_id, 'activity_created'
  );

  RETURN jsonb_build_object(
    'activityId', v_activity.id,
    'status', v_activity.status,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_activity(
  p_organization_id uuid,
  p_activity_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_activity jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, plugin_data
AS $$
DECLARE
  v_before plugin_data.csf_opportunities%ROWTYPE;
  v_after plugin_data.csf_opportunities%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_correlation_id uuid := gen_random_uuid();
  v_starts_at timestamptz := nullif(p_activity->>'startsAt', '')::timestamptz;
  v_ends_at timestamptz := nullif(p_activity->>'endsAt', '')::timestamptz;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'Actor is required.'; END IF;
  IF jsonb_typeof(p_activity) <> 'object' THEN RAISE EXCEPTION 'Activity payload must be an object.'; END IF;
  IF nullif(btrim(p_activity->>'title'), '') IS NULL THEN RAISE EXCEPTION 'Activity title is required.'; END IF;

  SELECT activity.* INTO v_before
  FROM plugin_data.csf_opportunities AS activity
  WHERE activity.organization_id = p_organization_id AND activity.id = p_activity_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF activity not found.'; END IF;
  IF v_before.status IN ('closed', 'cancelled', 'archived') THEN
    RAISE EXCEPTION 'Closed, cancelled, or archived activities cannot be edited.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Activities in a closed or archived semester cannot be edited.';
  END IF;
  IF v_before.status = 'published' AND v_starts_at IS NULL THEN
    RAISE EXCEPTION 'A start date is required for a published activity.';
  END IF;
  IF v_starts_at IS NOT NULL AND v_ends_at IS NOT NULL AND v_ends_at < v_starts_at THEN
    RAISE EXCEPTION 'The activity end time must be after its start time.';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'CSF class audience not found.';
  END IF;

  UPDATE plugin_data.csf_opportunities
  SET
    term_id = p_term_id,
    cohort_id = p_cohort_id,
    title = btrim(p_activity->>'title'),
    body = coalesce(nullif(p_activity->>'body', ''), btrim(p_activity->>'title')),
    starts_at = v_starts_at,
    ends_at = v_ends_at,
    location = nullif(p_activity->>'location', ''),
    signup_url = nullif(p_activity->>'signupUrl', ''),
    contact_email = nullif(p_activity->>'contactEmail', ''),
    point_value = coalesce((p_activity->>'pointValue')::numeric, 0),
    point_type = coalesce(nullif(p_activity->>'pointType', ''), 'non_drive'),
    point_cap = nullif(p_activity->>'pointCap', '')::numeric,
    signup_mode = coalesce(nullif(p_activity->>'signupMode', ''), 'external'),
    requires_point_submission = coalesce((p_activity->>'requiresPointSubmission')::boolean, true),
    evidence_policy = coalesce(nullif(p_activity->>'evidencePolicy', ''), 'required'),
    source_organization = nullif(p_activity->>'sourceOrganization', ''),
    linked_project_id = nullif(p_activity->>'linkedProjectId', '')::uuid,
    updated_at = now()
  WHERE organization_id = p_organization_id AND id = p_activity_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'activity.update',
    'csf_opportunities', p_activity_id, p_term_id,
    jsonb_build_object(
      'title', v_before.title, 'status', v_before.status, 'termId', v_before.term_id,
      'cohortId', v_before.cohort_id, 'pointValue', v_before.point_value, 'pointType', v_before.point_type
    ),
    jsonb_build_object(
      'title', v_after.title, 'status', v_after.status, 'termId', v_after.term_id,
      'cohortId', v_after.cohort_id, 'pointValue', v_after.point_value, 'pointType', v_after.point_type
    ),
    v_correlation_id, 'activity_updated'
  );

  RETURN jsonb_build_object('activityId', v_after.id, 'status', v_after.status, 'correlationId', v_correlation_id);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_update_term_policy_v2(
  uuid, uuid, numeric, numeric, numeric, integer, integer, boolean,
  jsonb, boolean, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_term_policy_v2(
  uuid, uuid, numeric, numeric, numeric, integer, integer, boolean,
  jsonb, boolean, numeric, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_update_term_policy_v2(
  uuid, uuid, numeric, numeric, numeric, integer, integer, boolean,
  jsonb, boolean, numeric, text, uuid
) IS 'Atomically versions academic, dues, service, drive, and meeting policy with immutable audit history.';

COMMENT ON FUNCTION plugin_data.csf_set_activity_status(uuid, uuid, text, text, uuid)
  IS 'Moves an organization-scoped CSF activity through its lifecycle and records the same-transaction audit event.';

COMMENT ON FUNCTION plugin_data.csf_create_activity(uuid, uuid, uuid, jsonb, uuid)
  IS 'Creates an organization-scoped activity and immutable audit record in one transaction.';

COMMENT ON FUNCTION plugin_data.csf_update_activity(uuid, uuid, uuid, uuid, jsonb, uuid)
  IS 'Updates an editable organization-scoped activity and immutable audit record in one transaction.';

COMMIT;
