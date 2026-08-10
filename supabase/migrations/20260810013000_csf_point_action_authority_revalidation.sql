-- Revalidate CSF point authority and current operational policy at the final
-- database boundary.  The renamed engines remain the single write/audit
-- implementations, but only these service-only wrappers may invoke them.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_actor_authority(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_keys text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.organization_members%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Point-action actor and organization are required.';
  END IF;

  SELECT member.*
  INTO v_member
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Point-action actor is not an active organization member.';
  END IF;

  IF coalesce(pg_catalog.array_length(p_permission_keys, 1), 0) = 0 THEN
    RETURN;
  END IF;

  -- Lock the current rows used by the canonical RBAC resolver so a concurrent
  -- position or permission revocation cannot commit between authorization and
  -- the consequential write.  The resolver below remains the sole decision;
  -- this scan intentionally does not reproduce its admin/owner semantics.
  PERFORM 1
  FROM plugin_data.csf_staff_positions AS staff_position
  JOIN plugin_data.csf_role_permissions AS permission
    ON permission.organization_id = staff_position.organization_id
   AND permission.role_id = staff_position.role_id
   AND permission.enabled = true
  WHERE staff_position.organization_id = p_organization_id
    AND staff_position.user_id = p_actor_user_id
    AND staff_position.status = 'active'
    AND (staff_position.starts_at IS NULL OR staff_position.starts_at <= current_date)
    AND (staff_position.ends_at IS NULL OR staff_position.ends_at >= current_date)
    AND permission.permission_key = ANY(p_permission_keys)
  ORDER BY staff_position.id, permission.permission_key
  LIMIT 1
  FOR UPDATE OF staff_position, permission;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_permission_keys) AS requested(permission_key)
    WHERE plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      requested.permission_key
    ) IS TRUE
  ) THEN
    RAISE EXCEPTION 'Point-action actor does not have the required permission.';
  END IF;
END;
$$;

-- Declare the shared eligibility signature before the review wrapper is
-- compiled; the complete locked implementation replaces this transaction-
-- local stub below, before any privilege is granted or the migration commits.
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
BEGIN
  RAISE EXCEPTION 'Point eligibility migration is incomplete.';
END;
$$;

ALTER FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid)
  RENAME TO csf_withdraw_point_submission_authority_base_20260810;

CREATE OR REPLACE FUNCTION plugin_data.csf_withdraw_point_submission(
  p_organization_id uuid,
  p_profile_id uuid,
  p_submission_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_lock_term_id uuid;
BEGIN
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.profile_id = p_profile_id
    AND submission.id = p_submission_id
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = submission.organization_id
        AND account.profile_id = submission.profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may withdraw this point submission.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  PERFORM 1
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may withdraw this point submission.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.profile_id = p_profile_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;
  IF v_submission.source <> 'student' THEN
    RAISE EXCEPTION 'Only a member-created point submission can be withdrawn.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be withdrawn in the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required to withdraw points.';
  END IF;

  IF v_submission.status <> 'submitted'
    OR v_submission.reviewed_by IS NOT NULL
    OR v_submission.reviewed_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = p_organization_id
        AND review.submission_id = p_submission_id
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_credit_records AS credit
      WHERE credit.organization_id = p_organization_id
        AND credit.submission_id = p_submission_id
    ) THEN
    RAISE EXCEPTION 'Only an untouched submitted point claim can be withdrawn.';
  END IF;

  RETURN plugin_data.csf_withdraw_point_submission_authority_base_20260810(
    p_organization_id,
    p_profile_id,
    p_submission_id,
    p_actor_user_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) RENAME TO csf_review_point_submission_v2_authority_base_20260810;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_submission_v2(
  p_organization_id uuid,
  p_submission_id uuid,
  p_action text,
  p_awarded_points numeric,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_lock_term_id uuid;
BEGIN
  IF p_action IS NULL
    OR p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;

  -- Permission is resolved and locked before any private submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be reviewed in the current open semester.';
  END IF;

  IF p_action = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving points.';
    END IF;

    v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'csf-private'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );
  END IF;

  RETURN plugin_data.csf_review_point_submission_v2_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_submit_point_appeal(
  uuid, uuid, text, numeric, uuid, uuid
) RENAME TO csf_submit_point_appeal_authority_base_20260810;

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_point_appeal(
  p_organization_id uuid,
  p_submission_id uuid,
  p_reason text,
  p_requested_points numeric,
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
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_lock_term_id uuid;
  v_lock_profile_id uuid;
BEGIN
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 10
    OR pg_catalog.length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal reason must contain between 10 and 2000 characters.';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'A point-appeal correlation identifier is required.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );

  SELECT submission.term_id, submission.profile_id
  INTO v_lock_term_id, v_lock_profile_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = submission.organization_id
        AND account.profile_id = submission.profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may appeal this point submission.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  PERFORM 1
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = v_lock_profile_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may appeal this point submission.';
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
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id
    OR v_submission.profile_id IS DISTINCT FROM v_lock_profile_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;
  IF v_submission.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Only an approved or rejected point submission may be appealed.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point appeals are only available for the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_submission.profile_id
    AND membership.term_id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required to appeal points.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.published_at IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required before appealing points.';
  END IF;
  IF p_requested_points IS NOT NULL
    AND (p_requested_points <= 0 OR p_requested_points > v_policy.max_points_per_activity) THEN
    RAISE EXCEPTION 'Requested points must be between 0 and %.',
      v_policy.max_points_per_activity;
  END IF;

  RETURN plugin_data.csf_submit_point_appeal_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    v_reason,
    p_requested_points,
    p_actor_user_id,
    p_correlation_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) RENAME TO csf_review_point_appeal_authority_base_20260810;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_appeal(
  p_organization_id uuid,
  p_appeal_id uuid,
  p_decision text,
  p_resolution_notes text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_credit plugin_data.csf_credit_records%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_resolution_notes text := nullif(pg_catalog.btrim(coalesce(p_resolution_notes, '')), '');
  v_lock_term_id uuid;
BEGIN
  IF p_decision IS NULL
    OR p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF v_resolution_notes IS NULL OR pg_catalog.length(v_resolution_notes) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal resolution notes must contain between 1 and 2000 characters.';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'A point-appeal decision correlation identifier is required.';
  END IF;

  -- Permission is resolved and locked before any private appeal evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['process_points']::text[]
  );

  SELECT appeal.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT appeal.*
  INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id
  FOR UPDATE;
  IF NOT FOUND OR v_appeal.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;
  IF v_appeal.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point appeal semester changed; refresh and try again.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = v_appeal.submission_id
    AND submission.profile_id = v_appeal.profile_id
    AND submission.term_id = v_appeal.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'The appealed point submission is no longer reviewable.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point appeals can only be reviewed in the current open semester.';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving an appeal.';
    END IF;

    v_awarded_points := coalesce(v_appeal.requested_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Appeal award must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before appeal approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'csf-private'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );
  END IF;

  SELECT credit.*
  INTO v_credit
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.submission_id = v_submission.id
  ORDER BY credit.created_at DESC, credit.id DESC
  LIMIT 1
  FOR UPDATE;

  RETURN plugin_data.csf_review_point_appeal_authority_base_20260810(
    p_organization_id,
    p_appeal_id,
    p_decision,
    v_resolution_notes,
    p_actor_user_id,
    p_correlation_id
  );
END;
$$;

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
    RAISE EXCEPTION 'A manual officer claim cannot use a structured point source.';
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
        AND v_opportunity.status NOT IN ('published', 'closed'))
      OR (NOT coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status <> 'published') THEN
      RAISE EXCEPTION 'This CSF activity is not available for this point action.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive')
      OR v_opportunity.point_type <> p_point_type THEN
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
    IF NOT p_point_type = ANY(v_partner_term.approved_point_types) THEN
      RAISE EXCEPTION 'Point type is not approved for the selected partner club.';
    END IF;
    v_source_cap := CASE p_point_type
      WHEN 'drive' THEN v_partner_term.drive_points
      ELSE v_partner_term.non_drive_points
    END;
    v_effective_cap := least(v_policy.max_points_per_activity, v_source_cap);
    IF v_source_cap IS NULL OR v_source_cap <= 0
      OR p_points > v_effective_cap THEN
      RAISE EXCEPTION 'Points exceed the selected partner-club limit of %.',
        v_effective_cap;
    END IF;
    v_proof_required := v_partner_term.proof_required;
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

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_actor_authority(uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_eligibility(
  uuid, uuid, uuid, uuid, uuid, text, numeric, text, boolean, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) RENAME TO csf_begin_point_submission_authority_base_20260810;

ALTER FUNCTION plugin_data.csf_finalize_point_submission_proof(uuid, uuid, uuid, uuid, uuid)
  RENAME TO csf_finalize_point_submission_proof_authority_base_20260810;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_submission(
  p_organization_id uuid,
  p_submission_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_opportunity_id uuid,
  p_partner_club_term_id uuid,
  p_source text,
  p_description text,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_actor_user_id uuid,
  p_file_id uuid,
  p_file_bucket text,
  p_file_object_path text,
  p_file_original_filename text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_upload_token uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_has_proof boolean := nullif(
    pg_catalog.btrim(coalesce(p_file_object_path, '')),
    ''
  ) IS NOT NULL;
BEGIN
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'Interactive point submissions must use a student or staff source.';
  END IF;
  IF p_file_object_path IS NOT NULL AND NOT v_has_proof THEN
    RAISE EXCEPTION 'Proof object path cannot be blank.';
  END IF;

  IF p_source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY[]::text[]
    );
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point claim.';
    END IF;
  END IF;

  PERFORM plugin_data.csf_assert_point_submission_eligibility(
    p_organization_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    p_source,
    p_claimed_points,
    p_point_type,
    v_has_proof,
    false,
    false
  );

  -- The eligibility helper now holds the canonical semester lock. Revalidate
  -- and lock student ownership only after that lock so begin/finalize/withdraw
  -- all use one deadlock-safe ordering.
  IF p_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point claim.';
    END IF;
  END IF;

  RETURN plugin_data.csf_begin_point_submission_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    p_source,
    v_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    p_file_id,
    p_file_bucket,
    p_file_object_path,
    p_file_original_filename,
    p_file_mime_type,
    p_file_size_bytes,
    p_upload_token,
    p_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_point_submission_proof(
  p_organization_id uuid,
  p_submission_id uuid,
  p_file_id uuid,
  p_upload_token uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_file plugin_data.csf_submission_files%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_lock_term_id uuid;
  v_lock_profile_id uuid;
  v_lock_source text;
BEGIN
  -- Authenticate before looking up private proof or submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );

  -- Resolve the semester from the opaque upload identity without exposing any
  -- proof metadata, then serialize with semester close before taking proof or
  -- submission row locks. The locked rows below must still match this snapshot.
  SELECT submission.term_id, submission.profile_id, submission.source
  INTO v_lock_term_id, v_lock_profile_id, v_lock_source
  FROM plugin_data.csf_submission_files AS proof
  JOIN plugin_data.csf_point_submissions AS submission
    ON submission.organization_id = proof.organization_id
   AND submission.id = proof.submission_id
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
    AND proof.upload_status = 'pending'
    AND proof.upload_token = p_upload_token
    AND proof.uploaded_by = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending proof identity is invalid or no longer finalizable.';
  END IF;

  IF v_lock_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_lock_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer finalize this proof.';
    END IF;
  ELSIF v_lock_source = 'staff' THEN
    -- Lock staff RBAC before the semester lock, matching begin/review ordering.
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    RAISE EXCEPTION 'This point source cannot use interactive proof finalization.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  IF v_lock_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_lock_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer finalize this proof.';
    END IF;
  END IF;

  SELECT proof.*
  INTO v_file
  FROM plugin_data.csf_submission_files AS proof
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
  FOR UPDATE;
  IF NOT FOUND OR v_file.upload_status <> 'pending'
    OR v_file.upload_token IS DISTINCT FROM p_upload_token
    OR v_file.uploaded_by IS DISTINCT FROM p_actor_user_id
    OR v_file.bucket <> 'csf-private'
    OR nullif(pg_catalog.btrim(v_file.object_path), '') IS NULL
    OR v_file.size_bytes IS NULL OR v_file.size_bytes <= 0 THEN
    RAISE EXCEPTION 'Pending proof identity is invalid or no longer finalizable.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft'
    OR v_submission.profile_id IS DISTINCT FROM v_file.profile_id
    OR v_submission.term_id IS DISTINCT FROM v_file.term_id
    OR v_submission.term_id IS DISTINCT FROM v_lock_term_id
    OR v_submission.profile_id IS DISTINCT FROM v_lock_profile_id
    OR v_submission.source IS DISTINCT FROM v_lock_source THEN
    RAISE EXCEPTION 'Point submission is not awaiting this proof finalization.';
  END IF;

  PERFORM plugin_data.csf_assert_point_submission_eligibility(
    p_organization_id,
    v_submission.profile_id,
    v_submission.term_id,
    v_submission.opportunity_id,
    v_submission.partner_club_term_id,
    v_submission.source,
    v_submission.claimed_points,
    v_submission.point_type,
    true,
    false,
    false
  );

  RETURN plugin_data.csf_finalize_point_submission_proof_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_file_id,
    p_upload_token,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_authority_base_20260810(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof_authority_base_20260810(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_withdraw_point_submission_authority_base_20260810(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2_authority_base_20260810(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_point_appeal_authority_base_20260810(
  uuid, uuid, text, numeric, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal_authority_base_20260810(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_point_appeal(
  uuid, uuid, text, numeric, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_point_appeal(
  uuid, uuid, text, numeric, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) IS
  'Service-only point-submission boundary that locks and revalidates actor, ownership, current membership, published policy, source, class, caps, and proof before delegating the atomic write engine.';
COMMENT ON FUNCTION plugin_data.csf_finalize_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Service-only proof finalizer that revalidates uploader authority, current membership, published policy, source caps, and proof requirements under lock before making a draft submission reviewable.';
COMMENT ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid) IS
  'Service-only member withdrawal boundary for a verified owner with active organization and semester membership, limited to an untouched current-term student claim.';
COMMENT ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) IS
  'Service-only point review boundary that locks reviewer permission and current-open term state for every decision, and rederives published policy, source, cap, class, and finalized-proof authority before approval.';
COMMENT ON FUNCTION plugin_data.csf_submit_point_appeal(
  uuid, uuid, text, numeric, uuid, uuid
) IS
  'Service-only appeal submission boundary for the verified owner of an approved or rejected current-term point claim, with active membership and published-policy cap revalidation.';
COMMENT ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Service-only appeal decision boundary that locks process-points authority, appeal, submission, current-open term, and existing credit for every decision, then rederives published policy, source, cap, class, and finalized-proof authority before approval.';

NOTIFY pgrst, 'reload schema';

COMMIT;
