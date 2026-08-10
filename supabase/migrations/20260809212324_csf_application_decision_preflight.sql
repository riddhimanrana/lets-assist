-- Make approval readiness one database-derived projection and enforce it under
-- the same locks as the consequential decision. Stored aggregate totals or a
-- green UI cannot substitute for current course, check, policy, and dues data.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_application_decision_readiness(
  p_organization_id uuid,
  p_application_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_dues_status text;
  v_required_check_count integer := 0;
  v_unresolved_check_count integer := 0;
  v_academic_check_status text;
  v_evaluated_policy_version integer;
  v_checks jsonb := '{}'::jsonb;
  v_course_count integer := 0;
  v_invalid_course_count integer := 0;
  v_disqualifying_course_count integer := 0;
  v_list_i_points numeric := 0;
  v_list_i_ii_points numeric := 0;
  v_total_points numeric := 0;
  v_minimum_list_i numeric := 4;
  v_minimum_list_i_ii numeric := 7;
  v_minimum_total numeric := 10;
  v_maximum_courses integer := 5;
  v_bonus_limit integer := 2;
  v_calculated_status text := 'pending';
  v_is_override boolean := false;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_application.term_id
  ORDER BY policy.policy_version DESC, policy.updated_at DESC
  LIMIT 1;

  SELECT
    count(*) FILTER (WHERE application_check.mandatory),
    count(*) FILTER (
      WHERE application_check.mandatory
        AND application_check.status NOT IN ('passed', 'waived', 'not_required')
    ),
    max(application_check.status::text) FILTER (
      WHERE application_check.check_type = 'academic_eligibility'
    ),
    max(
      CASE
        WHEN application_check.check_type = 'academic_eligibility'
          AND coalesce(application_check.details->>'policyVersion', '') ~ '^[0-9]+$'
          THEN (application_check.details->>'policyVersion')::integer
        ELSE NULL
      END
    ),
    coalesce(
      jsonb_object_agg(
        application_check.check_type::text,
        jsonb_build_object(
          'status', application_check.status,
          'mandatory', application_check.mandatory,
          'policyVersion', CASE
            WHEN coalesce(application_check.details->>'policyVersion', '') ~ '^[0-9]+$'
              THEN (application_check.details->>'policyVersion')::integer
            ELSE NULL
          END
        )
      ),
      '{}'::jsonb
    )
  INTO
    v_required_check_count,
    v_unresolved_check_count,
    v_academic_check_status,
    v_evaluated_policy_version,
    v_checks
  FROM plugin_data.csf_application_checks AS application_check
  WHERE application_check.organization_id = p_organization_id
    AND application_check.application_id = p_application_id;

  SELECT dues.status::text
  INTO v_dues_status
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.application_id = p_application_id;

  IF v_policy.id IS NOT NULL THEN
    v_minimum_list_i := coalesce((v_policy.academic_rules->>'minimumListI')::numeric, 4);
    v_minimum_list_i_ii := coalesce((v_policy.academic_rules->>'minimumListIAndII')::numeric, 7);
    v_minimum_total := coalesce((v_policy.academic_rules->>'minimumTotal')::numeric, 10);
    v_maximum_courses := coalesce((v_policy.academic_rules->>'maximumCourses')::integer, 5);
    v_bonus_limit := coalesce(
      (v_policy.academic_rules->>'bonusPointLimit')::integer,
      (v_policy.academic_rules->>'honorsApBonusLimit')::integer,
      2
    );
  END IF;

  -- Imported `points` is retained as source provenance, never decision
  -- authority. Recompute every base point from the current versioned policy's
  -- per-list grade map, falling back per missing/invalid key to the canonical
  -- CSF list rules. Explicit bonus flags remain separately capped below.
  WITH normalized_courses AS (
    SELECT
      course.id,
      course.course_list,
      nullif(btrim(course.course_name), '') AS course_name,
      nullif(btrim(course.grade), '') AS grade,
      regexp_replace(upper(btrim(coalesce(course.grade, ''))), '[+-]$', '') AS normalized_grade,
      course.is_bonus,
      course.created_at
    FROM plugin_data.csf_application_course_entries AS course
    WHERE course.organization_id = p_organization_id
      AND course.application_id = p_application_id
  ), course_rules AS (
    SELECT
      course.*,
      v_policy.academic_rules #> ARRAY[
        'gradePointValues', course.course_list, course.normalized_grade
      ] AS configured_points,
      CASE course.course_list
        WHEN 'I' THEN CASE course.normalized_grade
          WHEN 'A' THEN 3
          WHEN 'B' THEN 1
          ELSE 0
        END
        WHEN 'II' THEN CASE course.normalized_grade
          WHEN 'A' THEN 2
          WHEN 'B' THEN 1
          ELSE 0
        END
        WHEN 'III' THEN CASE course.normalized_grade
          WHEN 'A' THEN 1
          ELSE 0
        END
        ELSE 0
      END AS default_points
    FROM normalized_courses AS course
  ), ordered_courses AS (
    SELECT
      course.*,
      CASE
        WHEN jsonb_typeof(course.configured_points) = 'number' THEN CASE
          WHEN (course.configured_points::text)::numeric BETWEEN 0 AND 100
            THEN (course.configured_points::text)::numeric
          ELSE course.default_points
        END
        ELSE course.default_points
      END AS base_points,
      sum(CASE WHEN course.is_bonus THEN 1 ELSE 0 END) OVER (
        ORDER BY course.created_at, course.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS bonus_ordinal
    FROM course_rules AS course
  ), scored_courses AS (
    SELECT
      ordered.*,
      ordered.base_points + CASE
        WHEN ordered.is_bonus AND ordered.bonus_ordinal <= greatest(v_bonus_limit, 0)
          THEN 1
        ELSE 0
      END AS computed_points
    FROM ordered_courses AS ordered
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE course_name IS NULL OR grade IS NULL
    )::integer,
    coalesce(sum(computed_points) FILTER (WHERE course_list = 'I'), 0),
    coalesce(sum(computed_points) FILTER (WHERE course_list IN ('I', 'II')), 0),
    coalesce(sum(computed_points), 0),
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          coalesce(v_policy.academic_rules->'disqualifyingGrades', '["D","F"]'::jsonb)
        ) AS disqualifying(value)
        WHERE upper(btrim(disqualifying.value)) = scored_courses.normalized_grade
      )
    )::integer
  INTO
    v_course_count,
    v_invalid_course_count,
    v_list_i_points,
    v_list_i_ii_points,
    v_total_points,
    v_disqualifying_course_count
  FROM scored_courses;

  -- coalesce is load-bearing. Without it a missing academic-eligibility check
  -- leaves this NULL, and every later `IF NOT v_is_override` reads as unknown
  -- rather than false, silently dropping the eligibility blockers below.
  v_is_override := coalesce(
    v_application.eligibility_status::text = 'adviser_override'
    OR v_academic_check_status = 'waived',
    false
  );

  IF v_course_count > 0 AND v_invalid_course_count = 0 THEN
    v_calculated_status := CASE
      WHEN v_course_count > v_maximum_courses
        OR v_disqualifying_course_count > 0
        OR v_list_i_points < v_minimum_list_i
        OR v_list_i_ii_points < v_minimum_list_i_ii
        OR v_total_points < v_minimum_total
        THEN 'ineligible'
      ELSE 'eligible'
    END;
  END IF;

  IF v_application.submission_status NOT IN ('ready', 'under_review') THEN
    v_blockers := array_append(v_blockers, 'The application is not in a reviewable submission state.');
  END IF;
  IF v_required_check_count <> 6 THEN
    v_blockers := array_append(v_blockers, 'All six mandatory review checks must exist.');
  END IF;
  IF v_unresolved_check_count > 0 THEN
    v_blockers := array_append(v_blockers, format('%s mandatory check(s) remain unresolved.', v_unresolved_check_count));
  END IF;
  IF v_policy.id IS NULL THEN
    v_blockers := array_append(v_blockers, 'The semester policy is not configured.');
  END IF;
  -- coalesce, not a bare comparison: a MISSING academic check is not a waiver,
  -- and NULL <> 'waived' would silently skip this blocker entirely.
  IF coalesce(v_academic_check_status, '') <> 'waived'
    AND v_policy.id IS NOT NULL
    AND v_evaluated_policy_version IS DISTINCT FROM v_policy.policy_version
  THEN
    v_blockers := array_append(v_blockers, 'Academic eligibility was not evaluated under the current policy.');
  END IF;
  IF v_course_count = 0 THEN
    v_blockers := array_append(v_blockers, 'At least one course row is required; aggregate totals alone are not evidence.');
  END IF;
  IF v_invalid_course_count > 0 THEN
    v_blockers := array_append(v_blockers, 'Every counted course requires a course name and grade.');
  END IF;
  IF NOT v_is_override AND v_calculated_status <> 'eligible' THEN
    v_blockers := array_append(v_blockers, 'Current course evidence does not satisfy the semester academic policy.');
  END IF;
  IF NOT v_is_override
    AND v_application.eligibility_status::text IS DISTINCT FROM v_calculated_status
  THEN
    v_blockers := array_append(v_blockers, 'Stored eligibility disagrees with the current course calculation.');
  END IF;
  IF coalesce(v_dues_status, '') NOT IN ('verified', 'waived', 'not_required') THEN
    v_blockers := array_append(v_blockers, 'Dues must be verified, waived, or not required.');
  END IF;

  RETURN jsonb_build_object(
    'applicationId', p_application_id,
    'ready', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'requiredCheckCount', v_required_check_count,
    'unresolvedCheckCount', v_unresolved_check_count,
    'checks', v_checks,
    'submissionStatus', v_application.submission_status,
    'storedEligibilityStatus', v_application.eligibility_status,
    'calculatedEligibilityStatus', v_calculated_status,
    'academicCheckStatus', v_academic_check_status,
    'evaluatedPolicyVersion', v_evaluated_policy_version,
    'currentPolicyVersion', v_policy.policy_version,
    'courseCount', v_course_count,
    'invalidCourseCount', v_invalid_course_count,
    'calculatedPoints', jsonb_build_object(
      'listI', v_list_i_points,
      'listIAndII', v_list_i_ii_points,
      'total', v_total_points
    ),
    'duesStatus', v_dues_status,
    'adviserOverride', v_is_override
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  RENAME TO csf_decide_term_application_readiness_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_readiness jsonb;
  v_required_check_count integer := 0;
  v_unresolved_check_count integer := 0;
  v_dues_status text;
BEGIN
  -- The service-role RPC is not itself actor authority. Recheck the recorded
  -- officer before reading application evidence so a compromised server path
  -- cannot probe or decide another organization's private application.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'decide_applications'
  ) THEN
    RAISE EXCEPTION 'Not authorized to decide CSF applications.';
  END IF;

  IF p_decision <> 'accepted' THEN
    RETURN plugin_data.csf_decide_term_application_readiness_base(
      p_organization_id,
      p_application_id,
      p_decision,
      p_review_notes,
      p_actor_user_id
    );
  END IF;

  -- Approval is infrequent and consequential. These locks close the gap where
  -- a course/check/policy/dues row could change between preview and decision.
  LOCK TABLE plugin_data.csf_term_applications IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_application_checks IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_application_course_entries IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_term_policies IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_dues_records IN SHARE ROW EXCLUSIVE MODE;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found.';
  END IF;

  SELECT
    count(*) FILTER (WHERE application_check.mandatory),
    count(*) FILTER (
      WHERE application_check.mandatory
        AND application_check.status NOT IN ('passed', 'waived', 'not_required')
    )
  INTO v_required_check_count, v_unresolved_check_count
  FROM plugin_data.csf_application_checks AS application_check
  WHERE application_check.organization_id = p_organization_id
    AND application_check.application_id = p_application_id;

  SELECT dues.status::text
  INTO v_dues_status
  FROM plugin_data.csf_dues_records AS dues
  WHERE dues.organization_id = p_organization_id
    AND dues.application_id = p_application_id;

  -- Preserve the established exact errors for incomplete checks/dues while the
  -- delegated function performs its existing atomic decision and audit logic.
  IF v_required_check_count <> 6
    OR v_unresolved_check_count > 0
    OR coalesce(v_dues_status, '') NOT IN ('verified', 'waived', 'not_required')
  THEN
    RETURN plugin_data.csf_decide_term_application_readiness_base(
      p_organization_id,
      p_application_id,
      p_decision,
      p_review_notes,
      p_actor_user_id
    );
  END IF;

  v_readiness := plugin_data.csf_application_decision_readiness(
    p_organization_id,
    p_application_id
  );
  IF NOT coalesce((v_readiness->>'ready')::boolean, false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Application decision preflight is blocked.',
      DETAIL = (v_readiness->'blockers')::text,
      HINT = 'Refresh the application review and resolve every current blocker before approving.';
  END IF;

  RETURN plugin_data.csf_decide_term_application_readiness_base(
    p_organization_id,
    p_application_id,
    p_decision,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

CREATE UNIQUE INDEX csf_admin_audit_events_application_decision_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action = 'application.decision_request_committed';

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_request jsonb;
  v_result jsonb;
  v_membership_state jsonb := 'null'::jsonb;
  v_dues_state jsonb := 'null'::jsonb;
  v_platform_member_active boolean := false;
  v_request_fingerprint text;
  v_state_fingerprint text;
  v_decision_correlation_id uuid;
  v_status_event_id uuid;
  v_decision_audit_id uuid;
BEGIN
  -- Authorization must precede even the receipt lookup: a receipt confirms
  -- that a private application and decision exist.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'decide_applications'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to decide CSF applications.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable application-decision request identifier is required.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'decision', pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision, ''))),
    'reviewNotes', nullif(pg_catalog.btrim(coalesce(p_review_notes, '')), '')
  );
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_admin_request:'
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
    IF v_receipt.action IS DISTINCT FROM 'application.decision_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_term_applications'
      OR v_receipt.target_id IS DISTINCT FROM p_application_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That application-decision request identifier is already bound to a different change.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT application.*
    INTO v_application
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.id = p_application_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed application decision receipt is stale. Reload the application for its current state.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT coalesce(
      (
        SELECT to_jsonb(membership)
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = v_application.profile_id
          AND membership.term_id = v_application.term_id
        LIMIT 1
        FOR UPDATE
      ),
      'null'::jsonb
    )
    INTO v_membership_state;
    SELECT coalesce(
      (
        SELECT to_jsonb(dues)
        FROM plugin_data.csf_dues_records AS dues
        WHERE dues.organization_id = p_organization_id
          AND dues.application_id = p_application_id
        LIMIT 1
        FOR UPDATE
      ),
      'null'::jsonb
    )
    INTO v_dues_state;

    IF nullif(v_receipt.after_data -> 'result' ->> 'platformMemberUserId', '') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = (v_receipt.after_data -> 'result' ->> 'platformMemberUserId')::uuid
          AND member.status = 'active'
      )
      INTO v_platform_member_active;
    END IF;

    v_state_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'application', to_jsonb(v_application),
            'termMembership', v_membership_state,
            'dues', v_dues_state,
            'platformMemberActive', v_platform_member_active
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    IF v_receipt.after_data ->> 'stateFingerprint' IS DISTINCT FROM v_state_fingerprint
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_application_status_events AS event
        WHERE event.id = (v_receipt.after_data ->> 'statusEventId')::uuid
          AND event.organization_id = p_organization_id
          AND event.application_id = p_application_id
          AND event.actor_user_id = p_actor_user_id
          AND event.correlation_id = (v_receipt.after_data ->> 'decisionCorrelationId')::uuid
          AND event.next_status::text = pg_catalog.lower(pg_catalog.btrim(p_decision))
      )
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_admin_audit_events AS decision_audit
        WHERE decision_audit.id = (v_receipt.after_data ->> 'decisionAuditId')::uuid
          AND decision_audit.organization_id = p_organization_id
          AND decision_audit.actor_user_id = p_actor_user_id
          AND decision_audit.action = 'application.' || pg_catalog.lower(pg_catalog.btrim(p_decision))
          AND decision_audit.target_type = 'csf_term_applications'
          AND decision_audit.target_id = p_application_id
          AND decision_audit.correlation_id = (v_receipt.after_data ->> 'decisionCorrelationId')::uuid
      ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed application decision receipt is stale. Reload the application for its current state.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    RETURN v_receipt.after_data -> 'result';
  END IF;

  -- The five-argument implementation owns the current locked readiness and
  -- atomic decision transition. Calling it here keeps that work and this
  -- immutable receipt in the same database transaction.
  v_result := plugin_data.csf_decide_term_application(
    p_organization_id,
    p_application_id,
    p_decision,
    p_review_notes,
    p_actor_user_id
  );

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF application not found after its decision.';
  END IF;

  SELECT coalesce(
    (
      SELECT to_jsonb(membership)
      FROM plugin_data.csf_term_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_application.profile_id
        AND membership.term_id = v_application.term_id
      LIMIT 1
      FOR UPDATE
    ),
    'null'::jsonb
  )
  INTO v_membership_state;
  SELECT coalesce(
    (
      SELECT to_jsonb(dues)
      FROM plugin_data.csf_dues_records AS dues
      WHERE dues.organization_id = p_organization_id
        AND dues.application_id = p_application_id
      LIMIT 1
      FOR UPDATE
    ),
    'null'::jsonb
  )
  INTO v_dues_state;

  IF nullif(v_result ->> 'platformMemberUserId', '') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = (v_result ->> 'platformMemberUserId')::uuid
        AND member.status = 'active'
    )
    INTO v_platform_member_active;
  END IF;

  v_decision_correlation_id := nullif(v_result ->> 'correlationId', '')::uuid;
  SELECT event.id
  INTO v_status_event_id
  FROM plugin_data.csf_application_status_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.application_id = p_application_id
    AND event.actor_user_id = p_actor_user_id
    AND event.correlation_id = v_decision_correlation_id
    AND event.next_status::text = pg_catalog.lower(pg_catalog.btrim(p_decision))
  LIMIT 1;
  SELECT audit.id
  INTO v_decision_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.actor_user_id = p_actor_user_id
    AND audit.action = 'application.' || pg_catalog.lower(pg_catalog.btrim(p_decision))
    AND audit.target_type = 'csf_term_applications'
    AND audit.target_id = p_application_id
    AND audit.correlation_id = v_decision_correlation_id
  LIMIT 1;
  IF v_decision_correlation_id IS NULL
    OR v_status_event_id IS NULL
    OR v_decision_audit_id IS NULL THEN
    RAISE EXCEPTION 'The application decision did not produce complete audit evidence.';
  END IF;

  v_state_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'application', to_jsonb(v_application),
          'termMembership', v_membership_state,
          'dues', v_dues_state,
          'platformMemberActive', v_platform_member_active
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
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
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.decision_request_committed',
    'csf_term_applications',
    p_application_id,
    v_application.term_id,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'stateFingerprint', v_state_fingerprint,
      'decisionCorrelationId', v_decision_correlation_id,
      'statusEventId', v_status_event_id,
      'decisionAuditId', v_decision_audit_id,
      'result', v_result
    ),
    p_request_id,
    'application_decision_request',
    p_application_id::text,
    'application_decision_committed'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application_readiness_base(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_application_decision_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_application_decision_readiness(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_application_decision_readiness(uuid, uuid) IS
  'Canonical approval preflight derived from current submission, six checks, policy version, course rows/calculation, eligibility, and dues.';
COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid) IS
  'Owner-internal compatibility implementation that revalidates authority and performs the locked atomic decision; service callers must use the request-aware overload.';
COMMENT ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid, uuid) IS
  'Request-aware application decision entrypoint: reauthorizes before receipt evidence, binds actor and normalized intent, and returns a committed result only while its exact decision and membership state remain current.';

COMMIT;
