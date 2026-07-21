-- Make semester closure depend on the same explicit operational readiness
-- checks that officers see in the workspace. The term row is locked before
-- readiness is re-evaluated so the decisions, membership outcomes, closure
-- record, and immutable audit event commit as one transaction.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_term_closure_readiness(
  p_organization_id uuid,
  p_term_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_dues_required boolean := true;
  v_application_count integer := 0;
  v_point_submission_count integer := 0;
  v_point_appeal_count integer := 0;
  v_attendance_count integer := 0;
  v_dues_count integer := 0;
  v_total integer := 0;
  v_application_sample jsonb := '[]'::jsonb;
  v_point_submission_sample jsonb := '[]'::jsonb;
  v_point_appeal_sample jsonb := '[]'::jsonb;
  v_attendance_sample jsonb := '[]'::jsonb;
  v_dues_sample jsonb := '[]'::jsonb;
BEGIN
  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester not found.';
  END IF;

  SELECT coalesce(policy.dues_required, true)
  INTO v_dues_required
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id;

  v_dues_required := coalesce(v_dues_required, true);

  SELECT count(*)::integer
  INTO v_application_count
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.term_id = p_term_id
    AND application.decision_status = 'pending';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', application.id,
    'profileId', application.profile_id,
    'submissionStatus', application.submission_status,
    'eligibilityStatus', application.eligibility_status,
    'decisionStatus', application.decision_status,
    'assignedTo', application.assigned_to
  )), '[]'::jsonb)
  INTO v_application_sample
  FROM (
    SELECT application.*
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.term_id = p_term_id
      AND application.decision_status = 'pending'
    ORDER BY application.submitted_at NULLS FIRST, application.created_at, application.id
    LIMIT 25
  ) AS application;

  SELECT count(*)::integer
  INTO v_point_submission_count
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.term_id = p_term_id
    AND submission.status IN ('submitted', 'needs_action');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', submission.id,
    'profileId', submission.profile_id,
    'status', submission.status,
    'claimedPoints', submission.claimed_points,
    'pointType', submission.point_type
  )), '[]'::jsonb)
  INTO v_point_submission_sample
  FROM (
    SELECT submission.*
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.organization_id = p_organization_id
      AND submission.term_id = p_term_id
      AND submission.status IN ('submitted', 'needs_action')
    ORDER BY submission.submitted_at, submission.id
    LIMIT 25
  ) AS submission;

  SELECT count(*)::integer
  INTO v_point_appeal_count
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.term_id = p_term_id
    AND appeal.status IN ('submitted', 'under_review');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', appeal.id,
    'profileId', appeal.profile_id,
    'submissionId', appeal.submission_id,
    'status', appeal.status,
    'requestedPoints', appeal.requested_points
  )), '[]'::jsonb)
  INTO v_point_appeal_sample
  FROM (
    SELECT appeal.*
    FROM plugin_data.csf_point_appeals AS appeal
    WHERE appeal.organization_id = p_organization_id
      AND appeal.term_id = p_term_id
      AND appeal.status IN ('submitted', 'under_review')
    ORDER BY appeal.created_at, appeal.id
    LIMIT 25
  ) AS appeal;

  SELECT count(*)::integer
  INTO v_attendance_count
  FROM plugin_data.csf_meeting_attendance AS attendance
  WHERE attendance.organization_id = p_organization_id
    AND attendance.term_id = p_term_id
    AND (
      attendance.status = 'unknown'
      OR attendance.match_status IN ('needs_review', 'ambiguous', 'unmatched')
    );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', attendance.id,
    'profileId', attendance.profile_id,
    'meetingKey', attendance.meeting_key,
    'meetingLabel', attendance.meeting_label,
    'status', attendance.status,
    'matchStatus', attendance.match_status,
    'submittedName', attendance.submitted_name,
    'submittedEmail', attendance.submitted_email
  )), '[]'::jsonb)
  INTO v_attendance_sample
  FROM (
    SELECT attendance.*
    FROM plugin_data.csf_meeting_attendance AS attendance
    WHERE attendance.organization_id = p_organization_id
      AND attendance.term_id = p_term_id
      AND (
        attendance.status = 'unknown'
        OR attendance.match_status IN ('needs_review', 'ambiguous', 'unmatched')
      )
    ORDER BY attendance.source_submitted_at NULLS FIRST, attendance.created_at, attendance.id
    LIMIT 25
  ) AS attendance;

  IF v_dues_required THEN
    SELECT count(*)::integer
    INTO v_dues_count
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.status IN ('pending', 'accepted', 'active')
      AND NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_dues_records AS dues
        WHERE dues.organization_id = membership.organization_id
          AND dues.term_id = membership.term_id
          AND dues.profile_id = membership.profile_id
          AND dues.status IN ('verified', 'waived', 'not_required')
      );

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'profileId', due_profile.profile_id,
      'membershipId', due_profile.membership_id,
      'duesRecordId', due_profile.dues_record_id,
      'status', due_profile.dues_status
    )), '[]'::jsonb)
    INTO v_dues_sample
    FROM (
      SELECT
        membership.profile_id,
        membership.id AS membership_id,
        dues.id AS dues_record_id,
        coalesce(dues.status::text, 'missing') AS dues_status
      FROM plugin_data.csf_term_memberships AS membership
      LEFT JOIN LATERAL (
        SELECT record.id, record.status, record.updated_at
        FROM plugin_data.csf_dues_records AS record
        WHERE record.organization_id = membership.organization_id
          AND record.term_id = membership.term_id
          AND record.profile_id = membership.profile_id
        ORDER BY record.updated_at DESC, record.id
        LIMIT 1
      ) AS dues ON true
      WHERE membership.organization_id = p_organization_id
        AND membership.term_id = p_term_id
        AND membership.status IN ('pending', 'accepted', 'active')
        AND NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_dues_records AS resolved_dues
          WHERE resolved_dues.organization_id = membership.organization_id
            AND resolved_dues.term_id = membership.term_id
            AND resolved_dues.profile_id = membership.profile_id
            AND resolved_dues.status IN ('verified', 'waived', 'not_required')
        )
      ORDER BY membership.updated_at, membership.id
      LIMIT 25
    ) AS due_profile;
  END IF;

  v_total := v_application_count
    + v_point_submission_count
    + v_point_appeal_count
    + v_attendance_count
    + v_dues_count;

  RETURN jsonb_build_object(
    'termId', v_term.id,
    'termCode', v_term.code,
    'termLabel', v_term.label,
    'lifecycleStatus', v_term.lifecycle_status,
    'duesRequired', v_dues_required,
    'ready', v_total = 0 AND v_term.lifecycle_status NOT IN ('closed', 'archived'),
    'totalBlockers', v_total,
    'counts', jsonb_build_object(
      'applications', v_application_count,
      'pointSubmissions', v_point_submission_count,
      'pointAppeals', v_point_appeal_count,
      'attendance', v_attendance_count,
      'dues', v_dues_count
    ),
    'samples', jsonb_build_object(
      'applications', v_application_sample,
      'pointSubmissions', v_point_submission_sample,
      'pointAppeals', v_point_appeal_sample,
      'attendance', v_attendance_sample,
      'dues', v_dues_sample
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_close_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_policy_version integer,
  p_decisions jsonb,
  p_summary jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_profile_id uuid;
  v_derived_status text;
  v_effective_status text;
  v_now timestamptz := now();
  v_updated integer := 0;
  v_membership_count integer := 0;
  v_decision_count integer := 0;
  v_distinct_decision_count integer := 0;
  v_current_policy_version integer;
  v_readiness jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_closure_summary jsonb;
BEGIN
  IF jsonb_typeof(p_decisions) <> 'array' OR jsonb_array_length(p_decisions) = 0 THEN
    RAISE EXCEPTION 'Term close requires at least one membership decision.';
  END IF;
  IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
    RAISE EXCEPTION 'Term close summary must be an object.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
    AND term.lifecycle_status NOT IN ('closed', 'archived')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester is missing, closed, or archived.';
  END IF;

  SELECT policy.policy_version
  INTO v_current_policy_version
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester policy is missing.';
  END IF;
  IF p_policy_version <> v_current_policy_version THEN
    RAISE EXCEPTION 'CSF semester policy changed; refresh closure readiness and try again.';
  END IF;

  v_readiness := plugin_data.csf_term_closure_readiness(p_organization_id, p_term_id);
  IF coalesce((v_readiness->>'totalBlockers')::integer, 0) > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'CSF semester cannot be closed while operational work remains.',
      DETAIL = v_readiness::text,
      HINT = 'Resolve applications, point submissions and appeals, attendance reconciliation, and dues before closing.';
  END IF;

  SELECT count(*)::integer
  INTO v_membership_count
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.term_id = p_term_id
    AND membership.status IN ('pending', 'accepted', 'active');

  SELECT
    count(*)::integer,
    count(DISTINCT decision.value->>'profileId')::integer
  INTO v_decision_count, v_distinct_decision_count
  FROM jsonb_array_elements(p_decisions) AS decision(value);

  IF v_membership_count = 0 THEN
    RAISE EXCEPTION 'No active term memberships are available to close.';
  END IF;
  IF v_decision_count <> v_membership_count OR v_distinct_decision_count <> v_membership_count THEN
    RAISE EXCEPTION 'Term close requires exactly one decision for every active membership.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_decisions) AS decision(value)
    LEFT JOIN plugin_data.csf_term_memberships AS membership
      ON membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.profile_id = (decision.value->>'profileId')::uuid
      AND membership.status IN ('pending', 'accepted', 'active')
    WHERE membership.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Term close includes a decision outside the active membership roster.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_decisions)
  LOOP
    v_profile_id := (v_item->>'profileId')::uuid;
    v_derived_status := v_item->>'status';
    IF v_derived_status NOT IN ('completed', 'not_completed') THEN
      RAISE EXCEPTION 'Invalid term-close decision for profile %.', v_profile_id;
    END IF;

    SELECT coalesce(membership.override_status, v_derived_status)
    INTO v_effective_status
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.profile_id = v_profile_id
      AND membership.status IN ('pending', 'accepted', 'active')
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active term membership not found for profile %.', v_profile_id;
    END IF;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = v_effective_status,
      status_reason = coalesce(nullif(btrim(v_item->>'reason'), ''), status_reason),
      eligibility_snapshot = eligibility_snapshot || jsonb_build_object(
        'termClose', v_item,
        'policyVersion', p_policy_version,
        'correlationId', v_correlation_id,
        'closedAt', v_now
      ),
      completed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND term_id = p_term_id
      AND profile_id = v_profile_id;
    v_updated := v_updated + 1;
  END LOOP;

  v_closure_summary := p_summary || jsonb_build_object(
    'readiness', v_readiness,
    'correlationId', v_correlation_id
  );

  UPDATE plugin_data.csf_terms
  SET
    lifecycle_status = 'closed',
    is_current = false,
    closed_at = v_now,
    closed_by = p_actor_user_id,
    closure_policy_version = p_policy_version,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id;

  INSERT INTO plugin_data.csf_term_closures (
    organization_id, term_id, policy_version, summary, decisions, closed_by, closed_at
  ) VALUES (
    p_organization_id,
    p_term_id,
    p_policy_version,
    v_closure_summary,
    p_decisions,
    p_actor_user_id,
    v_now
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term.close',
    'csf_terms',
    p_term_id,
    p_term_id,
    jsonb_build_object(
      'policyVersion', p_policy_version,
      'summary', v_closure_summary,
      'membershipCount', v_updated
    ),
    v_correlation_id,
    'semester_closed'
  );

  RETURN jsonb_build_object(
    'termId', p_term_id,
    'membershipCount', v_updated,
    'closedAt', v_now,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_term_closure_readiness(uuid, uuid) IS
  'Returns the canonical counts and small evidence samples used to decide whether one CSF semester can close.';
COMMENT ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid) IS
  'Atomically rejects unresolved operational work, applies every active membership outcome, closes the semester, and writes correlated immutable audit history.';

COMMIT;
