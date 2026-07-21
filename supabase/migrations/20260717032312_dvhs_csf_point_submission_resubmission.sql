BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission(
  p_organization_id uuid,
  p_submission_id uuid,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_description text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_partner_status text;
  v_partner_cap numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_proof_required boolean := false;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-resubmission actor and correlation are required.';
  END IF;
  IF p_claimed_points IS NULL OR p_claimed_points <= 0 THEN
    RAISE EXCEPTION 'Claimed points must be greater than zero.';
  END IF;
  IF p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'Description is required.';
  END IF;
  IF length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must be 4000 characters or fewer.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_submission.profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Only the connected member may correct and resubmit this point submission.';
  END IF;
  IF v_submission.source <> 'student' THEN
    RAISE EXCEPTION 'Only a member-created point submission can be corrected and resubmitted.';
  END IF;
  IF v_submission.status <> 'needs_action' THEN
    RAISE EXCEPTION 'Only a correction-requested point submission can be resubmitted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_submission.term_id
      AND term.is_current = true
      AND term.lifecycle_status = 'open'
  ) THEN
    RAISE EXCEPTION 'Point corrections are only available for the current open semester.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_submission.profile_id
      AND membership.term_id = v_submission.term_id
      AND membership.status IN ('accepted', 'active')
  ) THEN
    RAISE EXCEPTION 'Your CSF membership must remain approved before resubmitting points.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_submission.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The semester policy must be published before point corrections can be accepted.';
  END IF;
  IF p_claimed_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Claimed points must be between 0 and %.', v_policy.max_points_per_activity;
  END IF;

  IF v_submission.opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = v_submission.opportunity_id
      AND opportunity.term_id = v_submission.term_id;
    IF NOT FOUND OR v_opportunity.status <> 'published' THEN
      RAISE EXCEPTION 'This CSF activity is not open for member point submissions.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded by an officer; member resubmission is not allowed.';
    END IF;
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive') THEN
      RAISE EXCEPTION 'This activity is not configured for CSF service points.';
    END IF;
    IF v_opportunity.point_type <> p_point_type THEN
      RAISE EXCEPTION 'Point type does not match the selected activity.';
    END IF;
    IF v_opportunity.point_value > 0 AND p_claimed_points > v_opportunity.point_value THEN
      RAISE EXCEPTION 'Claimed points exceed the selected activity limit of %.', v_opportunity.point_value;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF v_submission.partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = v_submission.partner_club_term_id
      AND club_term.term_id = v_submission.term_id;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not approved for the current semester.';
    END IF;
    SELECT club.status
    INTO v_partner_status
    FROM plugin_data.csf_partner_clubs AS club
    WHERE club.organization_id = p_organization_id
      AND club.id = v_partner_term.partner_club_id;
    IF NOT FOUND OR v_partner_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not approved for the current semester.';
    END IF;
    IF NOT p_point_type = ANY(v_partner_term.approved_point_types) THEN
      RAISE EXCEPTION 'Point type is not approved for the selected partner club.';
    END IF;
    v_partner_cap := CASE p_point_type
      WHEN 'drive' THEN v_partner_term.drive_points
      ELSE v_partner_term.non_drive_points
    END;
    IF v_partner_cap <= 0 OR p_claimed_points > v_partner_cap THEN
      RAISE EXCEPTION 'Claimed points exceed the selected partner-club limit of %.', v_partner_cap;
    END IF;
    v_proof_required := v_partner_term.proof_required;
  ELSE
    IF v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Outside volunteering is not allowed by the published semester policy.';
    END IF;
    v_proof_required := true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status <> 'finalized'
  ) THEN
    RAISE EXCEPTION 'Point-submission proof must be finalized before resubmission.';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status = 'finalized'
  ) INTO v_has_finalized_proof;
  IF v_proof_required AND NOT v_has_finalized_proof THEN
    RAISE EXCEPTION 'A finalized proof file is required before resubmission.';
  END IF;

  UPDATE plugin_data.csf_point_submissions
  SET
    claimed_points = p_claimed_points,
    point_type = p_point_type,
    activity_date = p_activity_date,
    description = v_description,
    status = 'submitted',
    submitted_by = p_actor_user_id,
    submitted_at = v_now,
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_notes = NULL,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_submission_id;

  INSERT INTO plugin_data.csf_submission_reviews (
    organization_id, submission_id, actor_user_id, action, previous_status,
    next_status, notes, details
  ) VALUES (
    p_organization_id, p_submission_id, p_actor_user_id, 'resubmitted',
    v_submission.status, 'submitted', NULL,
    jsonb_build_object(
      'correlationId', p_correlation_id,
      'previousClaimedPoints', v_submission.claimed_points,
      'claimedPoints', p_claimed_points,
      'previousPointType', v_submission.point_type,
      'pointType', p_point_type,
      'previousActivityDate', v_submission.activity_date,
      'activityDate', p_activity_date,
      'previousDescription', v_submission.description,
      'description', v_description,
      'proofRetained', v_has_finalized_proof
    )
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, before_data, after_data, correlation_id, source_type,
    source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_submission.profile_id,
    'point_submission.resubmit', 'csf_point_submissions', p_submission_id,
    v_submission.term_id,
    jsonb_build_object(
      'status', v_submission.status,
      'claimedPoints', v_submission.claimed_points,
      'pointType', v_submission.point_type,
      'activityDate', v_submission.activity_date,
      'description', v_submission.description,
      'reviewedBy', v_submission.reviewed_by,
      'reviewedAt', v_submission.reviewed_at,
      'reviewNotes', v_submission.review_notes
    ),
    jsonb_build_object(
      'status', 'submitted',
      'claimedPoints', p_claimed_points,
      'pointType', p_point_type,
      'activityDate', p_activity_date,
      'description', v_description,
      'proofRetained', v_has_finalized_proof
    ),
    p_correlation_id, 'point_submission', p_submission_id::text,
    'point_submission_corrected_by_member'
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'previousStatus', v_submission.status,
    'status', 'submitted',
    'correlationId', p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_resubmit_point_submission(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) IS
  'Atomically lets the connected member correct a needs-action point claim, revalidates current semester/source/policy/proof rules, and preserves prior review history while appending correlated resubmission evidence.';

NOTIFY pgrst, 'reload schema';

COMMIT;
