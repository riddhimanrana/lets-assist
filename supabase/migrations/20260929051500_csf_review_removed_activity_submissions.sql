-- Keep preserved submissions reviewable after their activity leaves the catalog.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_points numeric,
  p_point_type text,
  p_has_proof boolean,
  p_allow_closed_activity boolean,
  p_allow_legacy_manual boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_source_cap numeric(6,2);
  v_effective_cap numeric(6,2);
  v_proof_required boolean := false;
BEGIN
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points must be greater than zero.';
  END IF;
  IF p_point_type IS NULL OR p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_source IS NULL OR (p_source NOT IN ('student', 'staff')
    AND NOT (coalesce(p_allow_legacy_manual, false) AND p_source = 'manual')) THEN
    RAISE EXCEPTION 'This point source must use its dedicated reconciliation workflow.';
  END IF;
  IF p_source = 'manual'
    AND (p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A manual award cannot use a structured point source.';
  END IF;

  -- Match the canonical semester-close/evidence-writer lock before taking
  -- term-scoped row locks. This prevents a close from racing a validated
  -- point transition after its authority snapshot.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_term_id::text,
    0
  ));

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.record_status <> 'active' THEN
    RAISE EXCEPTION 'An active CSF profile is required for this point action.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point actions are only available for the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required for this point action.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.published_at IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required for this point action.';
  END IF;
  IF p_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Points exceed the semester activity limit of %.',
      v_policy.max_points_per_activity;
  END IF;

  IF p_opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_opportunity_id
      AND opportunity.term_id = p_term_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity belongs to a different organization or semester.';
    END IF;
    IF (coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status NOT IN ('published', 'closed', 'archived'))
      OR (NOT coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status <> 'published') THEN
      RAISE EXCEPTION 'This CSF activity is not available for this point action.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    -- Rule-driven activities resolve the category from the selected
    -- components; the stored point_type is only the lead category there.
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive')
      OR (v_opportunity.earning_rules IS NULL
        AND v_opportunity.point_type <> p_point_type) THEN
      RAISE EXCEPTION 'Point type does not match the selected CSF activity.';
    END IF;
    IF v_opportunity.cohort_id IS NOT NULL
      AND v_membership.cohort_id IS DISTINCT FROM v_opportunity.cohort_id THEN
      RAISE EXCEPTION 'This CSF activity is assigned to a different class.';
    END IF;

    v_source_cap := coalesce(
      v_opportunity.point_cap,
      CASE WHEN v_opportunity.point_value > 0 THEN v_opportunity.point_value END,
      v_policy.max_points_per_activity
    );
    v_effective_cap := least(v_policy.max_points_per_activity, v_source_cap);
    IF p_points > v_effective_cap THEN
      RAISE EXCEPTION 'Points exceed the selected activity limit of %.', v_effective_cap;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF p_partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = club_term.organization_id
     AND club.id = club_term.partner_club_id
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = p_partner_club_term_id
      AND club_term.term_id = p_term_id
      AND club.status = 'active'
    FOR UPDATE OF club_term, club;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not active for the current semester.';
    END IF;
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    -- Only active standing is enforced here, bounded by the semester policy
    -- cap already checked above.
    v_proof_required := p_source = 'student';
  ELSE
    IF p_source = 'student' THEN
      IF v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Outside volunteering is not allowed by the published semester policy.';
      END IF;
      v_proof_required := true;
    ELSE
      -- An authorized staff/manual entry is the only unstructured source that
      -- may intentionally waive a proof file.
      v_proof_required := false;
    END IF;
  END IF;

  IF v_proof_required AND p_has_proof IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A proof file is required for this point action.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id uuid, p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_existing_archived boolean := false;
BEGIN
 SELECT EXISTS (
   SELECT 1 FROM plugin_data.csf_point_submissions s
   JOIN plugin_data.csf_opportunities a ON a.organization_id=s.organization_id AND a.id=s.opportunity_id
   WHERE s.id=p_submission_id AND s.organization_id=p_organization_id
     AND s.profile_id=p_profile_id AND s.term_id=p_term_id
     AND s.opportunity_id=p_opportunity_id
     AND s.partner_club_term_id IS NOT DISTINCT FROM p_partner_club_term_id
     AND s.source=p_source AND s.status IN ('draft','submitted','needs_action','approved','rejected')
     AND a.status='archived'
 ) INTO v_existing_archived;
 IF EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id AND request_kind='exception') THEN
 PERFORM plugin_data.csf_assert_point_exception_eligibility(p_organization_id,p_profile_id,p_term_id,p_opportunity_id,p_partner_club_term_id,p_source,p_points,p_point_type,p_has_proof,p_allow_closed_activity,p_allow_legacy_manual);
 ELSE
 PERFORM plugin_data.csf_assert_point_submission_eligibility(p_organization_id,p_profile_id,p_term_id,p_opportunity_id,p_partner_club_term_id,p_source,p_points,p_point_type,p_has_proof,coalesce(p_allow_closed_activity,false) OR v_existing_archived,p_allow_legacy_manual);
 END IF;
END;
$function$;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean) TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_partner_status text;
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
    IF NOT FOUND OR v_opportunity.status NOT IN ('published', 'archived') THEN
      RAISE EXCEPTION 'This CSF activity is not open for member point submissions.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded by an officer; member resubmission is not allowed.';
    END IF;
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive') THEN
      RAISE EXCEPTION 'This activity is not configured for CSF service points.';
    END IF;
    IF v_opportunity.earning_rules IS NULL
      AND v_opportunity.point_type <> p_point_type THEN
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
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    v_proof_required := true;
  ELSE
    IF v_submission.request_kind<>'exception' AND v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
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
$function$;
REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid) TO postgres;

-- Indexed contact writes evaluate this pure text normalizer as the server role.
REVOKE ALL ON FUNCTION plugin_data.csf_normalize_email_text(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_normalize_email_text(text) TO service_role;

COMMIT;
