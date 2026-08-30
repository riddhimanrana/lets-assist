-- Consolidate CSF dashboard reads and bound high-growth review projections.
BEGIN;

CREATE INDEX IF NOT EXISTS csf_point_submissions_unresolved_queue_idx
  ON plugin_data.csf_point_submissions (
    organization_id,
    submitted_at DESC,
    id DESC
  )
  WHERE status IN ('draft', 'submitted', 'needs_action');

CREATE INDEX IF NOT EXISTS csf_point_appeals_unresolved_queue_idx
  ON plugin_data.csf_point_appeals (
    organization_id,
    created_at DESC,
    id DESC
  )
  WHERE status IN ('submitted', 'under_review');

CREATE INDEX IF NOT EXISTS csf_profiles_name_prefix_idx
  ON plugin_data.csf_profiles (
    organization_id,
    normalized_last_name text_pattern_ops,
    normalized_first_name text_pattern_ops,
    id
  )
  WHERE record_status = 'active';

CREATE INDEX IF NOT EXISTS csf_profiles_school_email_prefix_idx
  ON plugin_data.csf_profiles (
    organization_id,
    normalized_school_email text_pattern_ops,
    id
  )
  WHERE record_status = 'active' AND normalized_school_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS csf_profiles_personal_email_prefix_idx
  ON plugin_data.csf_profiles (
    organization_id,
    normalized_personal_email text_pattern_ops,
    id
  )
  WHERE record_status = 'active' AND normalized_personal_email IS NOT NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_dashboard_officer(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
      AND (
        member.role = 'admin'
        OR (
          member.role = 'staff'
          AND EXISTS (
            SELECT 1
            FROM plugin_data.csf_staff_positions AS position
            WHERE position.organization_id = p_organization_id
              AND position.user_id = p_actor_user_id
              AND position.status = 'active'
              AND position.school_year = plugin_data.csf_current_school_year(p_organization_id)
              AND (position.starts_at IS NULL OR position.starts_at <= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date)
              AND (position.ends_at IS NULL OR position.ends_at >= (pg_catalog.now() AT TIME ZONE 'America/Los_Angeles')::date)
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'CSF officer dashboard access denied.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_officer_home_snapshot(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_term_id uuid;
  v_recent_approvals jsonb := '[]'::jsonb;
BEGIN
  PERFORM plugin_data.csf_assert_dashboard_officer(
    p_organization_id,
    p_actor_user_id
  );

  SELECT term.id
  INTO v_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.updated_at DESC, term.id DESC
  LIMIT 1;

  IF v_current_term_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(row_value ORDER BY reviewed_at DESC NULLS LAST, created_at DESC), '[]'::jsonb)
    INTO v_recent_approvals
    FROM (
      SELECT
        application.reviewed_at,
        application.created_at,
        jsonb_build_object(
          'id', application.id,
          'reviewed_at', application.reviewed_at,
          'created_at', application.created_at,
          'profile', jsonb_build_object(
            'first_name', profile.first_name,
            'preferred_name', profile.preferred_name,
            'last_name', profile.last_name
          )
        ) AS row_value
      FROM plugin_data.csf_term_applications AS application
      JOIN plugin_data.csf_profiles AS profile
        ON profile.organization_id = application.organization_id
       AND profile.id = application.profile_id
      WHERE application.organization_id = p_organization_id
        AND application.term_id = v_current_term_id
        AND application.decision_status = 'approved'
      ORDER BY application.reviewed_at DESC NULLS LAST, application.created_at DESC
      LIMIT 4
    ) AS recent;
  END IF;

  RETURN jsonb_build_object(
    'dashboard', jsonb_build_object(
      'cohortCount', (SELECT count(*) FROM plugin_data.csf_cohorts WHERE organization_id = p_organization_id),
      'termCount', (SELECT count(*) FROM plugin_data.csf_terms WHERE organization_id = p_organization_id),
      'profileCount', (SELECT count(*) FROM plugin_data.csf_profiles WHERE organization_id = p_organization_id),
      'applicationCount', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id),
      'opportunityCount', (SELECT count(*) FROM plugin_data.csf_opportunities WHERE organization_id = p_organization_id),
      'pendingSubmissionCount', (SELECT count(*) FROM plugin_data.csf_point_submissions WHERE organization_id = p_organization_id AND status = 'submitted'),
      'activeRestrictionCount', (SELECT count(*) FROM plugin_data.csf_profile_restrictions WHERE organization_id = p_organization_id AND status = 'active'),
      'activeStaffCount', (SELECT count(*) FROM plugin_data.csf_staff_positions WHERE organization_id = p_organization_id AND status = 'active'),
      'pendingLinkRequestCount', (SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id = p_organization_id AND match_status = 'needs_review'),
      'pendingMergeReviewCount', (SELECT count(*) FROM plugin_data.csf_profile_merge_reviews WHERE organization_id = p_organization_id AND status = 'pending'),
      'pointRuleCount', (SELECT count(*) FROM plugin_data.csf_term_point_rules WHERE organization_id = p_organization_id),
      'activityEventCount', (SELECT count(*) FROM plugin_data.csf_profile_activity_events WHERE organization_id = p_organization_id),
      'termMeetingCount', (SELECT count(*) FROM plugin_data.csf_term_meetings WHERE organization_id = p_organization_id),
      'signupCount', (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id),
      'attendedSignupCount', (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id AND attendance_status = 'verified')
    ),
    'applications', jsonb_build_object(
      'currentTermId', v_current_term_id,
      'awaitingDecision', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND decision_status = 'pending'),
      'missingInformation', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND submission_status = 'missing_information'),
      'eligibilityExceptions', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND eligibility_status IN ('ineligible', 'adviser_override')),
      'duesReceipts', (SELECT count(*) FROM plugin_data.csf_dues_records WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND status = 'receipt_submitted'),
      'assignedToViewer', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND decision_status = 'pending' AND assigned_to = p_actor_user_id),
      'recentApprovals', v_recent_approvals
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_member_profile_snapshot(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_account_status text;
  v_current_term_id uuid;
  v_profile jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_actor_user_id
        AND member.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = p_actor_user_id
        AND account.status IN ('pending', 'verified')
    )
  ) THEN
    RAISE EXCEPTION 'CSF member dashboard access denied.'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.profile_id, account.status
  INTO v_profile_id, v_account_status
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status IN ('pending', 'verified')
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id DESC
  LIMIT 1;

  SELECT term.id
  INTO v_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.updated_at DESC, term.id DESC
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'profile', NULL,
      'accountStatus', NULL,
      'currentTermId', v_current_term_id
    );
  END IF;

  SELECT jsonb_build_object(
    'id', profile.id,
    'first_name', profile.first_name,
    'middle_name', profile.middle_name,
    'last_name', profile.last_name,
    'preferred_name', profile.preferred_name,
    'school_email', profile.school_email,
    'personal_email', profile.personal_email
  )
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = v_profile_id;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'accountStatus', v_account_status,
    'currentTermId', v_current_term_id,
    'events', coalesce((
      SELECT jsonb_agg(to_jsonb(event_row) ORDER BY event_row.event_at DESC, event_row.id DESC)
      FROM (
        SELECT id, term_id, title, description, event_type, event_at,
          point_type, raw_points, counted_points, status, source
        FROM plugin_data.csf_profile_activity_events
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY event_at DESC, id DESC LIMIT 25
      ) AS event_row
    ), '[]'::jsonb),
    'applications', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', application.id,
        'status', application.status,
        'submission_status', application.submission_status,
        'eligibility_status', application.eligibility_status,
        'decision_status', application.decision_status,
        'decision_reason', application.decision_reason,
        'source', application.source,
        'submitted_at', application.submitted_at,
        'reviewed_at', application.reviewed_at,
        'term', application.term,
        'cohort', application.cohort
      ) ORDER BY application.submitted_at DESC NULLS LAST, application.id DESC)
      FROM (
        SELECT
          source_application.*,
          jsonb_build_object(
            'id', term.id,
            'code', term.code,
            'label', term.label,
            'school_year', term.school_year,
            'semester', term.semester
          ) AS term,
          CASE
            WHEN cohort.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'label', cohort.label,
              'graduation_year', cohort.graduation_year
            )
          END AS cohort
        FROM plugin_data.csf_term_applications AS source_application
        JOIN plugin_data.csf_terms AS term
          ON term.organization_id = source_application.organization_id
         AND term.id = source_application.term_id
        LEFT JOIN plugin_data.csf_cohorts AS cohort
          ON cohort.organization_id = source_application.organization_id
         AND cohort.id = source_application.cohort_id
        WHERE source_application.organization_id = p_organization_id
          AND source_application.profile_id = v_profile_id
        ORDER BY source_application.submitted_at DESC NULLS LAST, source_application.id DESC
        LIMIT 25
      ) AS application
    ), '[]'::jsonb),
    'corrections', coalesce((
      SELECT jsonb_agg(to_jsonb(correction_row) ORDER BY correction_row.created_at DESC, correction_row.id DESC)
      FROM (
        SELECT id, application_id, check_type, message, status, review_reason, created_at, reviewed_at
        FROM plugin_data.csf_application_correction_requests
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY created_at DESC, id DESC LIMIT 20
      ) AS correction_row
    ), '[]'::jsonb),
    'credits', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', credit.id, 'term_id', credit.term_id, 'point_type', credit.point_type,
        'points', credit.points, 'status', credit.status, 'source', credit.source,
        'awarded_at', credit.verified_at, 'created_at', credit.created_at
      ) ORDER BY credit.created_at DESC, credit.id DESC)
      FROM (
        SELECT * FROM plugin_data.csf_credit_records
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY created_at DESC, id DESC LIMIT 25
      ) AS credit
    ), '[]'::jsonb),
    'submissions', coalesce((
      SELECT jsonb_agg(to_jsonb(submission_row) ORDER BY submission_row.submitted_at DESC, submission_row.id DESC)
      FROM (
        SELECT id, term_id, source, description, claimed_points, point_type, status, submitted_at, reviewed_at
        FROM plugin_data.csf_point_submissions
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY submitted_at DESC, id DESC LIMIT 25
      ) AS submission_row
    ), '[]'::jsonb),
    'memberships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', membership.cohort_id,
        'status', membership.status,
        'cohort', jsonb_build_object('id', cohort.id, 'label', cohort.label, 'graduation_year', cohort.graduation_year)
      ) ORDER BY cohort.graduation_year, cohort.id)
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      JOIN plugin_data.csf_cohorts AS cohort ON cohort.organization_id = membership.organization_id AND cohort.id = membership.cohort_id
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = v_profile_id
        AND membership.status <> 'archived'
    ), '[]'::jsonb),
    'termMemberships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', membership.id, 'term_id', membership.term_id, 'status', membership.status,
        'status_reason', membership.status_reason, 'override_status', membership.override_status,
        'override_reason', membership.override_reason, 'accepted_at', membership.accepted_at,
        'activated_at', membership.activated_at, 'completed_at', membership.completed_at
      ) ORDER BY membership.created_at, membership.id)
      FROM plugin_data.csf_term_memberships AS membership
      WHERE membership.organization_id = p_organization_id AND membership.profile_id = v_profile_id
    ), '[]'::jsonb),
    'attendance', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', attendance.id, 'term_id', attendance.term_id, 'meeting_key', attendance.meeting_key,
        'meeting_label', attendance.meeting_label, 'status', attendance.status, 'updated_at', attendance.updated_at
      ) ORDER BY attendance.meeting_key, attendance.id)
      FROM plugin_data.csf_meeting_attendance AS attendance
      WHERE attendance.organization_id = p_organization_id AND attendance.profile_id = v_profile_id
    ), '[]'::jsonb),
    'termPolicies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'term_id', policy.term_id, 'policy_version', policy.policy_version,
        'total_points_required', policy.total_points_required, 'max_drive_points', policy.max_drive_points,
        'max_points_per_activity', policy.max_points_per_activity, 'required_meetings', policy.required_meetings,
        'allowed_absences', policy.allowed_absences, 'allow_point_carryover', policy.allow_point_carryover,
        'outside_volunteering_allowed', policy.outside_volunteering_allowed
      ) ORDER BY policy.term_id)
      FROM plugin_data.csf_term_policies AS policy
      WHERE policy.organization_id = p_organization_id
    ), '[]'::jsonb),
    'dues', (
      SELECT to_jsonb(dues_row)
      FROM (
        SELECT id, application_id, status, required_amount, paid_amount, currency,
          submitted_at, verified_at, waived_at, waiver_reason
        FROM plugin_data.csf_dues_records
        WHERE organization_id = p_organization_id
          AND profile_id = v_profile_id
          AND term_id = v_current_term_id
        ORDER BY updated_at DESC, id DESC LIMIT 1
      ) AS dues_row
    ),
    'deadlines', coalesce((
      SELECT jsonb_agg(to_jsonb(deadline_row) ORDER BY deadline_row.due_at, deadline_row.id)
      FROM (
        SELECT id, title, description, due_at, status, audience, deadline_type
        FROM plugin_data.csf_term_deadlines
        WHERE organization_id = p_organization_id
          AND term_id = v_current_term_id
          AND audience IN ('members', 'applicants', 'all')
          AND status <> 'cancelled'
        ORDER BY due_at, id
      ) AS deadline_row
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_search_profiles(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_query text,
  p_selected_profile_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  first_name text,
  preferred_name text,
  last_name text,
  school_email text,
  personal_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_query text := regexp_replace(lower(btrim(coalesce(p_query, ''))), '[^a-z0-9@._+-]+', '', 'g');
BEGIN
  PERFORM plugin_data.csf_assert_dashboard_officer(p_organization_id, p_actor_user_id);

  IF p_selected_profile_id IS NULL AND length(v_query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.first_name, profile.preferred_name, profile.last_name,
    profile.school_email, profile.personal_email
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      (
        length(v_query) < 2
        AND profile.id = p_selected_profile_id
      )
      OR (
        length(v_query) >= 2
        AND (
          profile.id = p_selected_profile_id
          OR profile.normalized_first_name LIKE v_query || '%'
          OR profile.normalized_last_name LIKE v_query || '%'
          OR profile.normalized_school_email LIKE v_query || '%'
          OR profile.normalized_personal_email LIKE v_query || '%'
          OR (profile.normalized_first_name || profile.normalized_last_name) LIKE v_query || '%'
          OR (profile.normalized_last_name || profile.normalized_first_name) LIKE v_query || '%'
        )
      )
    )
  ORDER BY (profile.id = p_selected_profile_id) DESC,
    profile.normalized_last_name, profile.normalized_first_name, profile.id
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_post_reply_previews(
  p_organization_id uuid,
  p_announcement_ids uuid[],
  p_preview_limit integer DEFAULT 3
)
RETURNS TABLE (
  announcement_id uuid,
  reply_count bigint,
  replies jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requested AS (
    SELECT DISTINCT requested_id AS announcement_id
    FROM unnest(coalesce(p_announcement_ids, ARRAY[]::uuid[])) AS requested_id
    LIMIT 100
  ), ranked AS (
    SELECT
      reply.announcement_id,
      reply.id,
      reply.body,
      reply.created_at,
      reply.created_by,
      count(*) OVER (PARTITION BY reply.announcement_id) AS reply_count,
      row_number() OVER (
        PARTITION BY reply.announcement_id
        ORDER BY reply.created_at DESC, reply.id DESC
      ) AS recent_rank
    FROM plugin_data.csf_announcement_replies AS reply
    JOIN requested ON requested.announcement_id = reply.announcement_id
    WHERE reply.organization_id = p_organization_id
  )
  SELECT
    requested.announcement_id,
    coalesce(max(ranked.reply_count), 0)::bigint AS reply_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'announcement_id', ranked.announcement_id,
          'body', ranked.body,
          'created_at', ranked.created_at,
          'created_by', ranked.created_by
        )
        ORDER BY ranked.created_at, ranked.id
      ) FILTER (WHERE ranked.id IS NOT NULL),
      '[]'::jsonb
    ) AS replies
  FROM requested
  LEFT JOIN ranked
    ON ranked.announcement_id = requested.announcement_id
   AND ranked.recent_rank <= greatest(1, least(coalesce(p_preview_limit, 3), 10))
  GROUP BY requested.announcement_id;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_readiness_batch(
  p_organization_id uuid,
  p_job_ids uuid[]
)
RETURNS TABLE (
  job_id uuid,
  readiness jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT requested.job_id,
    plugin_data.csf_import_preview_readiness(
      p_organization_id,
      requested.job_id
    ) AS readiness
  FROM (
    SELECT DISTINCT requested_id AS job_id
    FROM unnest(coalesce(p_job_ids, ARRAY[]::uuid[])) AS requested_id
    LIMIT 100
  ) AS requested
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = p_organization_id
   AND job.id = requested.job_id;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_dashboard_officer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_search_profiles(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_post_reply_previews(uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_readiness_batch(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_dashboard_officer(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_search_profiles(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_post_reply_previews(uuid, uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_readiness_batch(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid) IS
  'Returns bounded officer Home counts and current-term application tasks after checking active staff membership.';
COMMENT ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) IS
  'Returns the bounded member profile projection in one service-only request after checking active organization membership.';
COMMENT ON FUNCTION plugin_data.csf_search_profiles(uuid, uuid, text, uuid) IS
  'Returns at most twenty active profile matches after two normalized characters, plus an explicitly selected profile when supplied.';
COMMENT ON FUNCTION plugin_data.csf_post_reply_previews(uuid, uuid[], integer) IS
  'Returns a bounded recent reply preview and total count for at most one hundred server-authorized posts.';
COMMENT ON FUNCTION plugin_data.csf_import_preview_readiness_batch(uuid, uuid[]) IS
  'Returns every requested import preview readiness projection in one service-only database request.';

COMMIT;
