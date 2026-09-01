-- Close the remaining authorization, audit, tenant, and read-bound release gaps.

BEGIN;

ALTER TABLE plugin_data.csf_class_workbooks
  ADD CONSTRAINT csf_class_workbooks_id_organization_id_key
  UNIQUE (id, organization_id);

ALTER TABLE plugin_data.csf_class_workbooks
  ADD CONSTRAINT csf_class_workbooks_cohort_organization_fk
  FOREIGN KEY (cohort_id, organization_id)
  REFERENCES plugin_data.csf_cohorts (id, organization_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE plugin_data.csf_class_workbooks
  VALIDATE CONSTRAINT csf_class_workbooks_cohort_organization_fk;

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  ADD CONSTRAINT csf_class_workbook_refresh_jobs_workbook_organization_fk
  FOREIGN KEY (workbook_id, organization_id)
  REFERENCES plugin_data.csf_class_workbooks (id, organization_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  VALIDATE CONSTRAINT csf_class_workbook_refresh_jobs_workbook_organization_fk;

REVOKE DELETE ON TABLE plugin_data.csf_import_approval_batches
  FROM service_role;
REVOKE DELETE ON TABLE plugin_data.csf_import_approval_batch_items
  FROM service_role;
REVOKE DELETE ON TABLE plugin_data.csf_import_commit_queue
  FROM service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_audit_import_approval_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_initial_count integer :=
    OLD.queued_count + OLD.blocked_count + OLD.stale_count + OLD.completed_count;
  v_new_initial_count integer :=
    NEW.queued_count + NEW.blocked_count + NEW.stale_count + NEW.completed_count;
  v_settled_completed_count integer;
  v_settled_blocked_count integer;
  v_settled_stale_count integer;
BEGIN
  IF v_old_initial_count <> OLD.requested_count
    AND v_new_initial_count = NEW.requested_count
  THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      after_data
    ) VALUES (
      NEW.organization_id,
      NEW.actor_user_id,
      'sheets.import_batch_approved',
      'csf_import_approval_batches',
      NEW.id,
      jsonb_build_object(
        'requestId', NEW.request_id,
        'requested', NEW.requested_count,
        'queued', NEW.queued_count,
        'blocked', NEW.blocked_count,
        'stale', NEW.stale_count,
        'alreadyCompleted', NEW.completed_count
      )
    );
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('completed', 'partially_completed')
  THEN
    SELECT
      count(*) FILTER (WHERE item.state = 'completed')::integer,
      count(*) FILTER (WHERE item.state = 'blocked')::integer,
      count(*) FILTER (WHERE item.state = 'stale')::integer
    INTO
      v_settled_completed_count,
      v_settled_blocked_count,
      v_settled_stale_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.batch_id = NEW.id;

    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      after_data
    ) VALUES (
      NEW.organization_id,
      NEW.actor_user_id,
      'sheets.import_batch_settled',
      'csf_import_approval_batches',
      NEW.id,
      jsonb_build_object(
        'status', NEW.status,
        'completed', v_settled_completed_count,
        'blocked', v_settled_blocked_count,
        'stale', v_settled_stale_count
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_audit_import_approval_batch()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_normalize_import_approval_batch_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'completed'
    AND (NEW.blocked_count > 0 OR NEW.stale_count > 0)
  THEN
    NEW.status := 'partially_completed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_normalize_import_approval_batch_status()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_import_approval_batches_normalize_status
BEFORE UPDATE ON plugin_data.csf_import_approval_batches
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_normalize_import_approval_batch_status();

CREATE TRIGGER csf_import_approval_batches_audit
AFTER UPDATE ON plugin_data.csf_import_approval_batches
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_audit_import_approval_batch();

CREATE OR REPLACE FUNCTION plugin_data.csf_finish_import_commit_queue(
  p_queue_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result_counts jsonb,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item plugin_data.csf_import_commit_queue%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'Choose a supported import queue result.';
  END IF;
  IF jsonb_typeof(p_result_counts) <> 'object' THEN
    RAISE EXCEPTION 'Import result counts must be an object.';
  END IF;
  SELECT * INTO v_item
  FROM plugin_data.csf_import_commit_queue AS queue
  WHERE queue.id = p_queue_id
  FOR UPDATE;
  IF NOT FOUND OR v_item.status <> 'running'
    OR v_item.lease_token IS DISTINCT FROM p_lease_token
    OR v_item.lease_expires_at <= now()
  THEN
    RAISE EXCEPTION 'The import worker lease is no longer active.';
  END IF;
  UPDATE plugin_data.csf_import_commit_queue
  SET status = p_status,
      result_counts = p_result_counts,
      error_code = left(p_error_code, 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_queue_id;
  UPDATE plugin_data.csf_import_approval_batch_items
  SET state = CASE p_status WHEN 'completed' THEN 'completed' ELSE 'blocked' END,
      reason_code = CASE p_status WHEN 'completed' THEN NULL ELSE left(p_error_code, 100) END
  WHERE queue_id = p_queue_id;
  UPDATE plugin_data.csf_import_approval_batches AS batch
  SET completed_count = counts.completed_count,
      blocked_count = counts.blocked_count,
      stale_count = counts.stale_count,
      status = CASE
        WHEN counts.open_count > 0 THEN 'running'
        WHEN counts.blocked_count > 0 OR counts.stale_count > 0
          THEN 'partially_completed'
        ELSE 'completed'
      END,
      updated_at = now()
  FROM (
    SELECT item.batch_id,
      count(*) FILTER (WHERE item.state = 'completed')::integer AS completed_count,
      count(*) FILTER (WHERE item.state = 'queued')::integer AS open_count,
      count(*) FILTER (WHERE item.state = 'blocked')::integer AS blocked_count,
      count(*) FILTER (WHERE item.state = 'stale')::integer AS stale_count
    FROM plugin_data.csf_import_approval_batch_items AS item
    WHERE item.batch_id IN (
      SELECT batch_item.batch_id
      FROM plugin_data.csf_import_approval_batch_items AS batch_item
      WHERE batch_item.queue_id = p_queue_id
    )
    GROUP BY item.batch_id
  ) AS counts
  WHERE batch.id = counts.batch_id;
  RETURN jsonb_build_object('finished', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_import_commit_queue(
  uuid, uuid, text, jsonb, text
) TO service_role;

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
  v_can_manage_classes boolean;
  v_can_manage_profiles boolean;
  v_can_view_applications boolean;
  v_can_review_dues boolean;
  v_can_manage_opportunities boolean;
  v_can_manage_restrictions boolean;
  v_can_process_points boolean;
  v_can_verify_submissions boolean;
  v_can_verify_participation boolean;
  v_can_manage_meetings boolean;
  v_can_manage_roles boolean;
  v_can_edit_point_rules boolean;
  v_recent_approvals jsonb := '[]'::jsonb;
BEGIN
  PERFORM plugin_data.csf_assert_dashboard_officer(
    p_organization_id,
    p_actor_user_id
  );

  v_can_manage_classes := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_cohorts_terms'
  );
  v_can_manage_profiles := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  );
  v_can_view_applications :=
    plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'view_applications'
    )
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'review_applications'
    );
  v_can_review_dues := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_payment_review'
  );
  v_can_manage_opportunities := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_opportunities'
  );
  v_can_manage_restrictions := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_restrictions'
  );
  v_can_process_points := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'process_points'
  );
  v_can_verify_submissions := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'verify_submissions'
  );
  v_can_verify_participation := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'verify_participation'
  );
  v_can_manage_meetings := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_meetings'
  );
  v_can_manage_roles := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_roles'
  );
  v_can_edit_point_rules := plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'edit_point_rules'
  );

  SELECT term.id
  INTO v_current_term_id
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current = true
  ORDER BY term.updated_at DESC, term.id DESC
  LIMIT 1;

  IF v_can_view_applications AND v_current_term_id IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        recent.row_value
        ORDER BY recent.reviewed_at DESC NULLS LAST, recent.created_at DESC
      ),
      '[]'::jsonb
    )
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
      'cohortCount', CASE WHEN v_can_manage_classes THEN
        (SELECT count(*) FROM plugin_data.csf_cohorts WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'termCount', CASE WHEN v_can_manage_classes THEN
        (SELECT count(*) FROM plugin_data.csf_terms WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'profileCount', CASE WHEN v_can_manage_profiles THEN
        (SELECT count(*) FROM plugin_data.csf_profiles WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'applicationCount', CASE WHEN v_can_view_applications THEN
        (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'opportunityCount', CASE WHEN v_can_manage_opportunities THEN
        (SELECT count(*) FROM plugin_data.csf_opportunities WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'pendingSubmissionCount', CASE WHEN v_can_verify_submissions THEN
        (SELECT count(*) FROM plugin_data.csf_point_submissions WHERE organization_id = p_organization_id AND status = 'submitted')
        ELSE 0 END,
      'activeRestrictionCount', CASE WHEN v_can_manage_restrictions THEN
        (SELECT count(*) FROM plugin_data.csf_profile_restrictions WHERE organization_id = p_organization_id AND status = 'active')
        ELSE 0 END,
      'activeStaffCount', CASE WHEN v_can_manage_roles THEN
        (SELECT count(*) FROM plugin_data.csf_staff_positions WHERE organization_id = p_organization_id AND status = 'active')
        ELSE 0 END,
      'pendingLinkRequestCount', CASE WHEN v_can_manage_profiles THEN
        (SELECT count(*) FROM plugin_data.csf_profile_link_requests WHERE organization_id = p_organization_id AND match_status = 'needs_review')
        ELSE 0 END,
      'pendingMergeReviewCount', CASE WHEN v_can_manage_profiles THEN
        (SELECT count(*) FROM plugin_data.csf_profile_merge_reviews WHERE organization_id = p_organization_id AND status = 'pending')
        ELSE 0 END,
      'pointRuleCount', CASE WHEN v_can_edit_point_rules THEN
        (SELECT count(*) FROM plugin_data.csf_term_point_rules WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'activityEventCount', CASE WHEN v_can_process_points THEN
        (SELECT count(*) FROM plugin_data.csf_profile_activity_events WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'termMeetingCount', CASE WHEN v_can_manage_meetings OR v_can_manage_classes THEN
        (SELECT count(*) FROM plugin_data.csf_term_meetings WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'signupCount', CASE WHEN v_can_verify_participation THEN
        (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id)
        ELSE 0 END,
      'attendedSignupCount', CASE WHEN v_can_verify_participation THEN
        (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id AND attendance_status = 'verified')
        ELSE 0 END
    ),
    'applications', jsonb_build_object(
      'currentTermId', CASE WHEN v_can_view_applications OR v_can_review_dues
        THEN v_current_term_id ELSE NULL END,
      'awaitingDecision', CASE WHEN v_can_view_applications THEN
        (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND decision_status = 'pending')
        ELSE 0 END,
      'missingInformation', CASE WHEN v_can_view_applications THEN
        (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND submission_status = 'missing_information')
        ELSE 0 END,
      'eligibilityExceptions', CASE WHEN v_can_view_applications THEN
        (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND eligibility_status IN ('ineligible', 'adviser_override'))
        ELSE 0 END,
      'duesReceipts', CASE WHEN v_can_review_dues THEN
        (SELECT count(*) FROM plugin_data.csf_dues_records WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND status = 'receipt_submitted')
        ELSE 0 END,
      'assignedToViewer', CASE WHEN v_can_view_applications THEN
        (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = v_current_term_id AND decision_status = 'pending' AND assigned_to = p_actor_user_id)
        ELSE 0 END,
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
        ORDER BY event_at DESC, id DESC LIMIT 50
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
        SELECT source_application.*,
          jsonb_build_object(
            'id', term.id,
            'code', term.code,
            'label', term.label,
            'school_year', term.school_year,
            'semester', term.semester
          ) AS term,
          CASE WHEN cohort.id IS NULL THEN NULL ELSE jsonb_build_object(
            'label', cohort.label,
            'graduation_year', cohort.graduation_year
          ) END AS cohort
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
        LIMIT 50
      ) AS application
    ), '[]'::jsonb),
    'corrections', coalesce((
      SELECT jsonb_agg(to_jsonb(correction_row) ORDER BY correction_row.created_at DESC, correction_row.id DESC)
      FROM (
        SELECT id, application_id, check_type, message, status, review_reason, created_at, reviewed_at
        FROM plugin_data.csf_application_correction_requests
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY created_at DESC, id DESC LIMIT 50
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
        ORDER BY created_at DESC, id DESC LIMIT 50
      ) AS credit
    ), '[]'::jsonb),
    'submissions', coalesce((
      SELECT jsonb_agg(to_jsonb(submission_row) ORDER BY submission_row.submitted_at DESC, submission_row.id DESC)
      FROM (
        SELECT id, term_id, source, description, claimed_points, point_type, status, submitted_at, reviewed_at
        FROM plugin_data.csf_point_submissions
        WHERE organization_id = p_organization_id AND profile_id = v_profile_id
        ORDER BY submitted_at DESC, id DESC LIMIT 50
      ) AS submission_row
    ), '[]'::jsonb),
    'memberships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'cohort_id', membership.cohort_id,
        'status', membership.status,
        'cohort', jsonb_build_object(
          'id', membership.cohort_id,
          'label', membership.label,
          'graduation_year', membership.graduation_year
        )
      ) ORDER BY membership.graduation_year, membership.cohort_id)
      FROM (
        SELECT source_membership.cohort_id, source_membership.status,
          cohort.label, cohort.graduation_year
        FROM plugin_data.csf_profile_cohort_memberships AS source_membership
        JOIN plugin_data.csf_cohorts AS cohort
          ON cohort.organization_id = source_membership.organization_id
         AND cohort.id = source_membership.cohort_id
        WHERE source_membership.organization_id = p_organization_id
          AND source_membership.profile_id = v_profile_id
          AND source_membership.status <> 'archived'
        ORDER BY cohort.graduation_year DESC, cohort.id DESC
        LIMIT 50
      ) AS membership
    ), '[]'::jsonb),
    'termMemberships', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', membership.id, 'term_id', membership.term_id, 'status', membership.status,
        'status_reason', membership.status_reason, 'override_status', membership.override_status,
        'override_reason', membership.override_reason, 'accepted_at', membership.accepted_at,
        'activated_at', membership.activated_at, 'completed_at', membership.completed_at
      ) ORDER BY membership.created_at, membership.id)
      FROM (
        SELECT source_membership.*
        FROM plugin_data.csf_term_memberships AS source_membership
        WHERE source_membership.organization_id = p_organization_id
          AND source_membership.profile_id = v_profile_id
        ORDER BY (source_membership.term_id = v_current_term_id) DESC,
          source_membership.created_at DESC, source_membership.id DESC
        LIMIT 50
      ) AS membership
    ), '[]'::jsonb),
    'attendance', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', attendance.id, 'term_id', attendance.term_id,
        'meeting_key', attendance.meeting_key,
        'meeting_label', attendance.meeting_label,
        'status', attendance.status,
        'updated_at', attendance.updated_at
      ) ORDER BY attendance.updated_at DESC, attendance.id DESC)
      FROM (
        SELECT source_attendance.*
        FROM plugin_data.csf_meeting_attendance AS source_attendance
        WHERE source_attendance.organization_id = p_organization_id
          AND source_attendance.profile_id = v_profile_id
        ORDER BY (source_attendance.term_id = v_current_term_id) DESC,
          source_attendance.updated_at DESC, source_attendance.id DESC
        LIMIT 50
      ) AS attendance
    ), '[]'::jsonb),
    'termPolicies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'term_id', policy.term_id,
        'policy_version', policy.policy_version,
        'total_points_required', policy.total_points_required,
        'max_drive_points', policy.max_drive_points,
        'max_points_per_activity', policy.max_points_per_activity,
        'required_meetings', policy.required_meetings,
        'allowed_absences', policy.allowed_absences,
        'allow_point_carryover', policy.allow_point_carryover,
        'outside_volunteering_allowed', policy.outside_volunteering_allowed
      ) ORDER BY policy.is_current DESC, policy.term_updated_at DESC, policy.term_id DESC)
      FROM (
        SELECT source_policy.*,
          (source_policy.term_id = v_current_term_id) AS is_current,
          term.updated_at AS term_updated_at
        FROM plugin_data.csf_term_policies AS source_policy
        JOIN plugin_data.csf_terms AS term
          ON term.organization_id = source_policy.organization_id
         AND term.id = source_policy.term_id
        WHERE source_policy.organization_id = p_organization_id
        ORDER BY (source_policy.term_id = v_current_term_id) DESC,
          term.updated_at DESC, source_policy.term_id DESC
        LIMIT 50
      ) AS policy
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
        LIMIT 50
      ) AS deadline_row
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_audit_import_approval_batch() IS
  'Writes count-only immutable audit events when an import approval batch is frozen and when it settles.';
COMMENT ON FUNCTION plugin_data.csf_officer_home_snapshot(uuid, uuid) IS
  'Returns only the officer Home counts allowed by the actor current capability set.';
COMMENT ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) IS
  'Returns the member profile projection with every list capped at fifty rows.';

COMMIT;
