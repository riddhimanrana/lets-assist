-- Partner-clubs simplification: retire representative access, audit
-- provenance / immutable member-sheet import batches, and per-club point
-- policy (approved point types, drive/non-drive caps, per-club proof
-- requirement). Partner clubs keep canonical identity, aliases, per-term
-- standing (workflow_status), the policy-review flag (allocation_satisfied +
-- policy_notes), and the append-only term-event ledger. A plain
-- spreadsheet_url per club term replaces the Drive-linked member Sheet;
-- member points against partner clubs are vetted manually at approval time,
-- bounded only by the published semester policy cap.
--
-- Replay note: csf_upsert_partner_club_policy keeps its signature and
-- event-ledger idempotency scheme, but the request fingerprint now covers the
-- simplified request shape. A pre-migration payload replayed with its old
-- request id will fingerprint-mismatch and be refused as a conflicting
-- review; callers mint a fresh request id per submit, so this is acceptable.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Drop representative and audit-import RPCs (latest signatures; wrapper
--    variants from 20260813013300 included).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS plugin_data.csf_assign_partner_representative(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_assign_partner_representative_locked_impl(
  uuid, uuid, text, text, text, date, boolean, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_revoke_partner_representative(
  uuid, uuid, uuid, text, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_revoke_partner_representative_locked_impl(
  uuid, uuid, uuid, text, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_acknowledge_partner_representative(
  uuid, uuid, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_request_partner_representative_correction(
  uuid, uuid, uuid, text, text, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_partner_audit_batch_readiness_blockers(
  uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  uuid, uuid, uuid, text, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
);
DROP FUNCTION IF EXISTS plugin_data.csf_commit_partner_audit_import_identity_base(
  uuid, uuid, text, uuid, text, uuid, uuid
);

-- ---------------------------------------------------------------------------
-- B. Re-create every surviving function that referenced the dropped tables or
--    the dropped policy columns, from their latest committed bodies.
-- ---------------------------------------------------------------------------

-- csf_assert_point_submission_eligibility: partner branch keeps only
-- active-standing enforcement.
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

-- csf_resubmit_point_submission: same partner-branch simplification.
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
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    v_proof_required := true;
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

-- csf_point_submission_receipt_state: club-term snapshot drops the four
-- retired policy keys.
CREATE OR REPLACE FUNCTION plugin_data.csf_point_submission_receipt_state(
  p_organization_id uuid,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'submissionId', submission.id,
    'organizationId', submission.organization_id,
    'profileId', submission.profile_id,
    'termId', submission.term_id,
    'opportunityId', submission.opportunity_id,
    'partnerClubTermId', submission.partner_club_term_id,
    'source', submission.source,
    'descriptionDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(submission.description, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'claimedPoints', submission.claimed_points,
    'pointType', submission.point_type,
    'activityDate', submission.activity_date,
    'status', submission.status,
    'submittedBy', submission.submitted_by,
    'submittedAtEpoch', extract(epoch FROM submission.submitted_at),
    'reviewedBy', submission.reviewed_by,
    'reviewedAtEpoch', CASE
      WHEN submission.reviewed_at IS NULL THEN NULL
      ELSE extract(epoch FROM submission.reviewed_at)
    END,
    'reviewNotesDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(submission.review_notes, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'createdAtEpoch', extract(epoch FROM submission.created_at),
    'updatedAtEpoch', extract(epoch FROM submission.updated_at),
    'supportingEvidence', pg_catalog.jsonb_build_object(
      'profile', (
        SELECT pg_catalog.jsonb_build_object(
          'recordStatus', profile.record_status,
          'updatedAtEpoch', extract(epoch FROM profile.updated_at)
        )
        FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = submission.organization_id
          AND profile.id = submission.profile_id
      ),
      'term', (
        SELECT pg_catalog.jsonb_build_object(
          'isCurrent', term.is_current,
          'lifecycleStatus', term.lifecycle_status,
          'updatedAtEpoch', extract(epoch FROM term.updated_at)
        )
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = submission.organization_id
          AND term.id = submission.term_id
      ),
      'membership', (
        SELECT pg_catalog.jsonb_build_object(
          'membershipId', membership.id,
          'status', membership.status,
          'cohortId', membership.cohort_id,
          'updatedAtEpoch', extract(epoch FROM membership.updated_at)
        )
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = submission.organization_id
          AND membership.profile_id = submission.profile_id
          AND membership.term_id = submission.term_id
      ),
      'policy', (
        SELECT pg_catalog.jsonb_build_object(
          'publishedAtEpoch', CASE
            WHEN policy.published_at IS NULL THEN NULL
            ELSE extract(epoch FROM policy.published_at)
          END,
          'maxPointsPerActivity', policy.max_points_per_activity,
          'outsideVolunteeringAllowed', policy.outside_volunteering_allowed,
          'updatedAtEpoch', extract(epoch FROM policy.updated_at)
        )
        FROM plugin_data.csf_term_policies AS policy
        WHERE policy.organization_id = submission.organization_id
          AND policy.term_id = submission.term_id
      ),
      'opportunity', (
        SELECT pg_catalog.jsonb_build_object(
          'opportunityId', opportunity.id,
          'termId', opportunity.term_id,
          'cohortId', opportunity.cohort_id,
          'status', opportunity.status,
          'pointValue', opportunity.point_value,
          'pointCap', opportunity.point_cap,
          'pointType', opportunity.point_type,
          'requiresPointSubmission', opportunity.requires_point_submission,
          'evidencePolicy', opportunity.evidence_policy,
          'updatedAtEpoch', extract(epoch FROM opportunity.updated_at)
        )
        FROM plugin_data.csf_opportunities AS opportunity
        WHERE opportunity.organization_id = submission.organization_id
          AND opportunity.id = submission.opportunity_id
      ),
      'partnerClubTerm', (
        SELECT pg_catalog.jsonb_build_object(
          'partnerClubTermId', club_term.id,
          'partnerClubId', club_term.partner_club_id,
          'termId', club_term.term_id,
          'workflowStatus', club_term.workflow_status,
          'updatedAtEpoch', extract(epoch FROM club_term.updated_at),
          'clubStatus', club.status,
          'clubUpdatedAtEpoch', extract(epoch FROM club.updated_at)
        )
        FROM plugin_data.csf_partner_club_terms AS club_term
        JOIN plugin_data.csf_partner_clubs AS club
          ON club.organization_id = club_term.organization_id
         AND club.id = club_term.partner_club_id
        WHERE club_term.organization_id = submission.organization_id
          AND club_term.id = submission.partner_club_term_id
      )
    ),
    'proofs', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'fileId', proof.id,
          'status', proof.upload_status,
          'uploaderId', proof.uploaded_by,
          'uploadCorrelationId', proof.upload_correlation_id,
          'sizeBytes', proof.size_bytes,
          'mimeType', proof.mime_type,
          'finalizedAtEpoch', CASE
            WHEN proof.finalized_at IS NULL THEN NULL
            ELSE extract(epoch FROM proof.finalized_at)
          END,
          'failedAtEpoch', CASE
            WHEN proof.failed_at IS NULL THEN NULL
            ELSE extract(epoch FROM proof.failed_at)
          END,
          'createdAtEpoch', extract(epoch FROM proof.created_at),
          'updatedAtEpoch', extract(epoch FROM proof.updated_at)
        ) ORDER BY proof.created_at, proof.id
      )
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = submission.organization_id
        AND proof.submission_id = submission.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'reviewId', review.id,
          'actorUserId', review.actor_user_id,
          'action', review.action,
          'previousStatus', review.previous_status,
          'nextStatus', review.next_status,
          'notesDigest', pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(coalesce(review.notes, ''), 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'detailsDigest', pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(coalesce(review.details, '{}'::jsonb)::text, 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'createdAtEpoch', extract(epoch FROM review.created_at)
        ) ORDER BY review.created_at, review.id
      )
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = submission.organization_id
        AND review.submission_id = submission.id
    ), '[]'::jsonb),
    'credit', (
      SELECT pg_catalog.jsonb_build_object(
        'creditId', credit.id,
        'points', credit.points,
        'pointType', credit.point_type,
        'status', credit.status,
        'verifiedBy', credit.verified_by,
        'verifiedAtEpoch', CASE
          WHEN credit.verified_at IS NULL THEN NULL
          ELSE extract(epoch FROM credit.verified_at)
        END,
        'evidenceDigest', pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(coalesce(credit.evidence, '{}'::jsonb)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'updatedAtEpoch', extract(epoch FROM credit.updated_at)
      )
      FROM plugin_data.csf_credit_records AS credit
      WHERE credit.organization_id = submission.organization_id
        AND credit.submission_id = submission.id
      ORDER BY credit.created_at DESC, credit.id DESC
      LIMIT 1
    ),
    'appeals', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'appealId', appeal.id,
          'status', appeal.status,
          'requestedPoints', appeal.requested_points,
          'submittedBy', appeal.submitted_by,
          'reviewedBy', appeal.reviewed_by,
          'reviewedAtEpoch', CASE
            WHEN appeal.reviewed_at IS NULL THEN NULL
            ELSE extract(epoch FROM appeal.reviewed_at)
          END,
          'correlationId', appeal.correlation_id,
          'decisionCorrelationId', appeal.decision_correlation_id,
          'updatedAtEpoch', extract(epoch FROM appeal.updated_at)
        ) ORDER BY appeal.created_at, appeal.id
      )
      FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.organization_id = submission.organization_id
        AND appeal.submission_id = submission.id
    ), '[]'::jsonb)
  )
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
$$;

-- csf_profile_merge_reference_plan: dropped-table references removed.
CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'sameTransactionRewrites', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profiles.merged_into_profile_id',
        'scope', 'prior merge tombstones pointing at the source',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profiles AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.id <> p_source_profile_id
            AND referenced_row.merged_into_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_accounts.profile_id',
        'scope', 'status is not revoked',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status <> 'revoked')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_cohort_memberships.profile_id',
        'scope', 'all current membership rows; exact duplicates consolidate first',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_applications.profile_id',
        'scope', 'all application ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_applications AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_application_files.profile_id',
        'scope', 'all application evidence ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_application_files AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_staff_positions.profile_id',
        'scope', 'all staff-position ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_staff_positions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_restrictions.profile_id',
        'scope', 'all current restriction rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_restrictions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_point_submissions.profile_id',
        'scope', 'all submissions after the active-claim collision preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_point_submissions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_submission_files.profile_id',
        'scope', 'all submission evidence ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_submission_files AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_credit_records.profile_id',
        'scope', 'all awarded-credit ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_credit_records AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_meeting_attendance.profile_id',
        'scope', 'all attendance ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_meeting_attendance AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'unfrozen not-started reconciliation result with no frozen target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'live_rewrite')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_link_requests.matched_profile_id',
        'scope', 'all current match bindings',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_link_requests.candidate_profile_ids',
        'scope', 'all candidate arrays, rewritten and de-duplicated in ordinal order',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND p_source_profile_id = ANY (referenced_row.candidate_profile_ids))
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_activity_events.profile_id',
        'scope', 'all current activity ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_activity_events AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_opportunity_signups.profile_id',
        'scope', 'all signup ownership rows after unique-key preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_opportunity_signups AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_memberships.profile_id',
        'scope', 'all current semester-membership rows after unique-key preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_memberships AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_point_appeals.profile_id',
        'scope', 'all point-appeal ownership rows after the open-appeal collision preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_point_appeals AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_dues_records.profile_id',
        'scope', 'all dues ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_dues_records AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_onboarding_links.recipient_profile_id',
        'scope', 'all direct invitations; open delivery, acceptance, expiry, and cancellation state is preserved',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_onboarding_links AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.recipient_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_application_correction_requests.profile_id',
        'scope', 'all correction-request ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_application_correction_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_communication_broadcast_preferences.profile_id',
        'scope', 'all current communication preferences',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_broadcast_preferences AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      )
    ),
    'immutableHistoryRetentions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_accounts.profile_id',
        'scope', 'status is revoked; immutable account-binding history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status = 'revoked')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_reviews.source_profile_id',
        'scope', 'immutable merge decision history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_merge_reviews AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.source_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_reviews.target_profile_id',
        'scope', 'immutable prior merge decision history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_merge_reviews AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.target_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_admin_audit_events.actor_profile_id',
        'scope', 'immutable actor snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_admin_audit_events AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.actor_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_membership_outcomes.profile_id',
        'scope', 'immutable semester-close snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_membership_outcomes AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_communication_recipient_snapshots.profile_id',
        'scope', 'immutable broadcast audience snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_recipient_snapshots AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'settled successful or terminally skipped import evidence',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'immutable_history')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.commit_target_profile_id',
        'scope', 'settled successful or terminally skipped frozen target evidence',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.commit_target_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'immutable_history')
      )
    ),
    'preflightBlockedReferences', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'frozen, retryable, in-flight, ambiguous, or malformed import target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'preflight_blocker')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.commit_target_profile_id',
        'scope', 'frozen, retryable, in-flight, ambiguous, or malformed import target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.commit_target_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'preflight_blocker')
      )
    ),
    'preflightBlockers', pg_catalog.jsonb_build_array(
      'term_application_unique_key',
      'term_membership_unique_key',
      'cohort_active_union',
      'meeting_attendance_unique_key',
      'opportunity_signup_unique_key',
      'verified_account_binding',
      'active_point_submission_claim_unique_key',
      'active_staff_assignment_unique_key',
      'open_point_appeal_unique_key',
      'outstanding_import_commit_target'
    )
  )
$$;

-- csf_merge_profiles (5-arg): dropped-table rewrites and counts removed.
CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_duplicate record;
  v_now timestamptz := pg_catalog.now();
  v_resolved_status text;
  v_resolved_created_at timestamptz;
  v_consolidated jsonb := '[]'::jsonb;
  v_result jsonb;
  v_review_id uuid;
  v_correlation_id uuid;
  v_prior_tombstones integer := 0;
  v_candidate_arrays integer := 0;
  v_direct_invitations integer := 0;
  v_correction_requests integer := 0;
  v_preferences integer := 0;
  v_import_live_matches integer := 0;
  v_live_source_references bigint := 0;
  v_reference_rewrites jsonb;
  v_retained_history jsonb;
BEGIN
  -- A service-role call is not actor authority. Recheck the named officer
  -- before taking identity locks or revealing whether either profile exists.
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why these two CSF student records are duplicates.';
  END IF;

  -- First lock in the shared hierarchy. It serializes only identity mutations
  -- in this organization; unrelated organizations remain independent.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  -- Stabilize the exact import evidence set before preview. Claim now takes the
  -- same organization lock before its coordinate/row locks; this row order then
  -- agrees with the commit worklist. If claim won first, preview sees a blocker.
  -- If merge won first, claim freezes the rewritten target after merge commits.
  PERFORM 1
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND (
      import_row.matched_profile_id = p_source_profile_id
      OR import_row.commit_target_profile_id = p_source_profile_id
    )
  ORDER BY import_row.job_id, import_row.sheet_tab_name,
    import_row.row_number, import_row.id
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
  INTO v_import_live_matches
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.matched_profile_id = p_source_profile_id
    AND plugin_data.csf_profile_merge_import_row_disposition(
      import_row.commit_frozen_at,
      import_row.commit_target_profile_id,
      import_row.matched_profile_id,
      import_row.commit_attempt_id,
      import_row.commit_retry_count,
      import_row.commit_outcome_state,
      import_row.import_status,
      import_row.commit_outcome_resolution
    ) = 'live_rewrite';

  -- Gate on the canonical preview BEFORE consolidating. Consolidation deletes
  -- the shared source rows; running this check afterwards would let a source
  -- that is active in a class the target only archived slip past both this
  -- function and the base's own re-check.
  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF COALESCE((v_preview ->> 'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview -> 'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, point claim, appeal, staff assignment, verified-account, or outstanding import recovery records.';
  END IF;

  -- Consolidate exact duplicates deterministically. The target keeps the
  -- canonical row; only the duplicate source row is removed, so the historical
  -- base's bare profile_id move cannot hit UNIQUE (profile_id, cohort_id).
  FOR v_duplicate IN
    SELECT
      source_row.id AS source_id,
      target_row.id AS target_id,
      source_row.cohort_id AS cohort_id,
      source_row.status AS source_status,
      target_row.status AS target_status,
      source_row.created_at AS source_created_at,
      target_row.created_at AS target_created_at,
      source_row.updated_at AS source_updated_at,
      target_row.updated_at AS target_updated_at
    FROM plugin_data.csf_profile_cohort_memberships AS source_row
    JOIN plugin_data.csf_profile_cohort_memberships AS target_row
      ON target_row.organization_id = source_row.organization_id
     AND target_row.cohort_id = source_row.cohort_id
     AND target_row.profile_id = p_target_profile_id
    WHERE source_row.organization_id = p_organization_id
      AND source_row.profile_id = p_source_profile_id
    ORDER BY source_row.cohort_id
  LOOP
    -- Status precedence: active > transferred > archived.
    v_resolved_status := CASE
      WHEN v_duplicate.source_status = 'active'
        OR v_duplicate.target_status = 'active' THEN 'active'
      WHEN v_duplicate.source_status = 'transferred'
        OR v_duplicate.target_status = 'transferred' THEN 'transferred'
      ELSE 'archived'
    END;
    v_resolved_created_at := LEAST(
      v_duplicate.source_created_at,
      v_duplicate.target_created_at
    );

    UPDATE plugin_data.csf_profile_cohort_memberships
    SET status = v_resolved_status,
        created_at = v_resolved_created_at,
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_duplicate.target_id
      AND profile_id = p_target_profile_id;

    DELETE FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = p_organization_id
      AND id = v_duplicate.source_id
      AND profile_id = p_source_profile_id;

    v_consolidated := v_consolidated || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'cohortId', v_duplicate.cohort_id,
        'retainedMembershipId', v_duplicate.target_id,
        'removedMembershipId', v_duplicate.source_id,
        'resolvedStatus', v_resolved_status,
        'before', pg_catalog.jsonb_build_object(
          'source', pg_catalog.jsonb_build_object(
            'membershipId', v_duplicate.source_id,
            'profileId', p_source_profile_id,
            'status', v_duplicate.source_status,
            'createdAt', v_duplicate.source_created_at,
            'updatedAt', v_duplicate.source_updated_at
          ),
          'target', pg_catalog.jsonb_build_object(
            'membershipId', v_duplicate.target_id,
            'profileId', p_target_profile_id,
            'status', v_duplicate.target_status,
            'createdAt', v_duplicate.target_created_at,
            'updatedAt', v_duplicate.target_updated_at
          )
        ),
        'after', pg_catalog.jsonb_build_object(
          'membershipId', v_duplicate.target_id,
          'profileId', p_target_profile_id,
          'status', v_resolved_status,
          'createdAt', v_resolved_created_at,
          'updatedAt', v_now
        )
      )
    );
  END LOOP;

  -- Flatten older tombstones before the source itself becomes a tombstone, so
  -- canonical resolution never has to follow a source -> source -> target
  -- chain. The source row is deliberately excluded and is finalized by the
  -- historical merge implementation below.
  UPDATE plugin_data.csf_profiles
  SET merged_into_profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id <> p_source_profile_id
    AND merged_into_profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_prior_tombstones = ROW_COUNT;

  -- Candidate arrays are a non-FK profile reference. Rewrite the source and
  -- collapse any resulting duplicate target while preserving first ordinal.
  UPDATE plugin_data.csf_profile_link_requests AS request
  SET candidate_profile_ids = (
        SELECT pg_catalog.array_agg(candidate.profile_id ORDER BY candidate.first_ordinal)
        FROM (
          SELECT
            rewritten.profile_id,
            pg_catalog.min(rewritten.ordinality) AS first_ordinal
          FROM (
            SELECT
              CASE
                WHEN entry.profile_id = p_source_profile_id THEN p_target_profile_id
                ELSE entry.profile_id
              END AS profile_id,
              entry.ordinality
            FROM pg_catalog.unnest(request.candidate_profile_ids)
              WITH ORDINALITY AS entry(profile_id, ordinality)
          ) AS rewritten
          GROUP BY rewritten.profile_id
        ) AS candidate
      ),
      updated_at = v_now
  WHERE request.organization_id = p_organization_id
    AND p_source_profile_id = ANY (request.candidate_profile_ids);
  GET DIAGNOSTICS v_candidate_arrays = ROW_COUNT;

  v_result := plugin_data.csf_merge_profiles_identity_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );
  IF NULLIF(v_result ->> 'importRowLiveMatches', '')::integer
    IS DISTINCT FROM v_import_live_matches THEN
    RAISE EXCEPTION
      'Profile merge planned % live import match rewrite(s) but executed %.',
      v_import_live_matches,
      COALESCE(NULLIF(v_result ->> 'importRowLiveMatches', '')::integer, -1);
  END IF;

  -- These later schema references did not exist when the historical merge
  -- implementation was written. They are current ownership projections, so
  -- move them in this same transaction without changing delivery, acceptance,
  -- correction, representative, or consent state.
  UPDATE plugin_data.csf_onboarding_links
  SET recipient_profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND recipient_profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_direct_invitations = ROW_COUNT;

  UPDATE plugin_data.csf_application_correction_requests
  SET profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_correction_requests = ROW_COUNT;

  UPDATE plugin_data.csf_communication_broadcast_preferences
  SET profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_preferences = ROW_COUNT;

  -- Deliberate history references are excluded here. Any current/live source
  -- ownership left behind is an implementation defect and aborts atomically.
  SELECT COALESCE(pg_catalog.sum(reference_count), 0)
  INTO v_live_source_references
  FROM (
    SELECT pg_catalog.count(*) AS reference_count
    FROM plugin_data.csf_profiles AS referenced_row
    WHERE referenced_row.organization_id = p_organization_id
      AND referenced_row.id <> p_source_profile_id
      AND referenced_row.merged_into_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
        AND referenced_row.status <> 'revoked'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_term_applications AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_application_files AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_staff_positions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_restrictions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_point_submissions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_submission_files AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_credit_records AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_meeting_attendance AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND referenced_row.matched_profile_id = p_source_profile_id
        AND plugin_data.csf_profile_merge_import_row_disposition(
          referenced_row.commit_frozen_at,
          referenced_row.commit_target_profile_id,
          referenced_row.matched_profile_id,
          referenced_row.commit_attempt_id,
          referenced_row.commit_retry_count,
          referenced_row.commit_outcome_state,
          referenced_row.import_status,
          referenced_row.commit_outcome_resolution
        ) <> 'immutable_history'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND referenced_row.commit_target_profile_id = p_source_profile_id
        AND plugin_data.csf_profile_merge_import_row_disposition(
          referenced_row.commit_frozen_at,
          referenced_row.commit_target_profile_id,
          referenced_row.matched_profile_id,
          referenced_row.commit_attempt_id,
          referenced_row.commit_retry_count,
          referenced_row.commit_outcome_state,
          referenced_row.import_status,
          referenced_row.commit_outcome_resolution
        ) <> 'immutable_history'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND p_source_profile_id = ANY (referenced_row.candidate_profile_ids)
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_activity_events AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_opportunity_signups AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_term_memberships AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_point_appeals AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_dues_records AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_onboarding_links AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.recipient_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_application_correction_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_broadcast_preferences AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
  ) AS live_references;
  IF v_live_source_references <> 0 THEN
    RAISE EXCEPTION 'Profile merge left % unintended live references on the source record.',
      v_live_source_references;
  END IF;

  v_review_id := NULLIF(v_result ->> 'reviewId', '')::uuid;
  v_correlation_id := NULLIF(v_result ->> 'correlationId', '')::uuid;
  IF v_review_id IS NULL OR v_correlation_id IS NULL THEN
    RAISE EXCEPTION 'The profile merge did not return the evidence identifiers its reference record requires.';
  END IF;

  v_reference_rewrites := pg_catalog.jsonb_build_object(
    'priorMergeTombstones', v_prior_tombstones,
    'profileLinkCandidateArrays', v_candidate_arrays,
    'importRowLiveMatches', v_import_live_matches,
    'directInvitations', v_direct_invitations,
    'applicationCorrectionRequests', v_correction_requests,
    'communicationPreferences', v_preferences
  );
  v_retained_history := plugin_data.csf_profile_merge_reference_plan(
    p_organization_id,
    p_source_profile_id
  ) -> 'immutableHistoryRetentions';

  -- Provenance beside the approved review. Identifiers, states, timestamps,
  -- and counts only: no name, email, or other student attribute.
  UPDATE plugin_data.csf_profile_merge_reviews
  SET evidence = COALESCE(evidence, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'cohortConsolidation', v_consolidated,
          'profileReferencePlan', v_preview -> 'profileReferencePlan',
          'referenceRewriteCounts', v_reference_rewrites,
          'retainedHistoryAfterMerge', v_retained_history,
          'zeroLiveSourceReferences', true
        ),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The profile merge review that must carry reference evidence is missing.';
  END IF;

  -- Immutable audit, scoped to the merge correlation. This receipt proves the
  -- later-schema rewrite set and postcondition without altering the historical
  -- canonical merge audit referenced_row.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge',
    'csf_profile_reference_rewrites',
    p_target_profile_id,
    pg_catalog.jsonb_build_object('sourceProfileId', p_source_profile_id),
    pg_catalog.jsonb_build_object(
      'targetProfileId', p_target_profile_id,
      'reviewId', v_review_id,
      'referenceRewriteCounts', v_reference_rewrites,
      'retainedHistory', v_retained_history,
      'zeroLiveSourceReferences', true
    ),
    v_correlation_id,
    'profile_merge_reference_rewrite',
    p_source_profile_id::text,
    'duplicate_profile_references_reconciled'
  );

  IF pg_catalog.jsonb_array_length(v_consolidated) > 0 THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      before_data,
      after_data,
      correlation_id,
      source_type,
      source_id,
      reason_code
    )
    SELECT
      p_organization_id,
      p_actor_user_id,
      'profile.merge',
      'csf_profile_cohort_memberships',
      (entry.payload ->> 'retainedMembershipId')::uuid,
      entry.payload -> 'before',
      (entry.payload -> 'after') || pg_catalog.jsonb_build_object(
        'cohortId', entry.payload -> 'cohortId',
        'removedMembershipId', entry.payload -> 'removedMembershipId',
        'sourceProfileId', p_source_profile_id,
        'targetProfileId', p_target_profile_id,
        'reviewId', v_review_id
      ),
      v_correlation_id,
      'profile_merge_cohort_consolidation',
      p_source_profile_id::text,
      'duplicate_profile_cohort_consolidated'
    FROM pg_catalog.jsonb_array_elements(v_consolidated) AS entry(payload);
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'movedRecords', COALESCE((v_result ->> 'movedRecords')::integer, 0)
      + v_prior_tombstones + v_candidate_arrays + v_import_live_matches
      + v_direct_invitations
      + v_correction_requests + v_preferences,
    'referenceRewriteCounts', v_reference_rewrites,
    'retainedHistory', v_retained_history,
    'zeroLiveSourceReferences', true
  );
END;
$$;

-- csf_merge_profiles_account_order_base: partner-submission ownership
-- rewrite removed (body carried forward from 20260812072357, renamed by
-- 20260812073000).
CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_account_order_base(p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_preview jsonb;
  v_review_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_moved_accounts integer := 0;
  v_moved_records integer := 0;
  v_moved_import_matches integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why these two CSF student records are duplicates.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  SELECT profile.* INTO v_source
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_source_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source CSF student record not found.'; END IF;

  SELECT profile.* INTO v_target
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_target_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target CSF student record not found.'; END IF;
  IF v_source.record_status <> 'active' THEN RAISE EXCEPTION 'The source CSF student record has already been merged.'; END IF;
  IF v_target.record_status <> 'active' THEN RAISE EXCEPTION 'The target CSF student record is not active.'; END IF;

  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF coalesce((v_preview->>'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview->'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, or verified-account records.';
  END IF;

  INSERT INTO plugin_data.csf_profile_merge_reviews (
    id, organization_id, source_profile_id, target_profile_id, reason,
    evidence, status, requested_by, reviewed_by, reviewed_at, notes,
    correlation_id, source_snapshot, target_snapshot, conflict_snapshot,
    created_at, updated_at
  ) VALUES (
    v_review_id,
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    btrim(p_reason),
    jsonb_build_object('preview', v_preview),
    'approved',
    p_actor_user_id,
    p_actor_user_id,
    v_now,
    'Completed through the audited member correction workflow.',
    v_correlation_id,
    v_preview->'source',
    v_preview->'target',
    v_preview->'conflicts',
    v_now,
    v_now
  );

  -- Revoke duplicate source accounts before promoting the matching target.
  -- The data-modifying CTE preserves the source values while ensuring the
  -- partial verified-account unique index never observes two verified rows.
  WITH source_snapshot AS MATERIALIZED (
    SELECT
      source_account.id AS source_account_id,
      source_account.status AS source_status,
      source_account.is_primary AS source_is_primary,
      source_account.linked_by AS source_linked_by,
      source_account.linked_at AS source_linked_at,
      target_account.id AS target_account_id
    FROM plugin_data.csf_profile_accounts AS source_account
    JOIN plugin_data.csf_profile_accounts AS target_account
      ON target_account.organization_id = source_account.organization_id
     AND target_account.profile_id = p_target_profile_id
     AND target_account.user_id = source_account.user_id
    WHERE source_account.organization_id = p_organization_id
      AND source_account.profile_id = p_source_profile_id
    FOR UPDATE OF source_account, target_account
  ),
  revoked_source AS (
    UPDATE plugin_data.csf_profile_accounts AS source_account
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now,
        notes = concat_ws(E'\n', nullif(source_account.notes, ''), 'Superseded by profile merge ' || v_correlation_id::text || '.')
    FROM source_snapshot
    WHERE source_account.id = source_snapshot.source_account_id
    RETURNING source_account.id
  )
  UPDATE plugin_data.csf_profile_accounts AS target_account
  SET status = CASE
        WHEN source_snapshot.source_status = 'verified' THEN 'verified'
        WHEN target_account.status = 'verified' THEN 'verified'
        WHEN source_snapshot.source_status = 'pending' THEN 'pending'
        ELSE target_account.status
      END,
      is_primary = CASE
        WHEN source_snapshot.source_status = 'verified'
          AND source_snapshot.source_is_primary THEN true
        ELSE target_account.is_primary
      END,
      linked_by = coalesce(target_account.linked_by, source_snapshot.source_linked_by),
      linked_at = least(target_account.linked_at, source_snapshot.source_linked_at),
      revoked_at = CASE
        WHEN source_snapshot.source_status = 'verified'
          OR target_account.status = 'verified' THEN NULL
        ELSE target_account.revoked_at
      END,
      notes = concat_ws(E'\n', nullif(target_account.notes, ''), 'Duplicate account row consolidated during profile merge ' || v_correlation_id::text || '.')
  FROM source_snapshot
  WHERE target_account.id = source_snapshot.target_account_id
    AND EXISTS (
      SELECT 1
      FROM revoked_source
      WHERE revoked_source.id = source_snapshot.source_account_id
    );

  UPDATE plugin_data.csf_profile_accounts
  SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id
    AND status <> 'revoked';
  GET DIAGNOSTICS v_moved_accounts = ROW_COUNT;

  UPDATE plugin_data.csf_term_applications SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_term_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_cohort_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_submissions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_credit_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_appeals SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_submission_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_meeting_attendance SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_opportunity_signups SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_activity_events SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_restrictions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_staff_positions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_application_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_dues_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_sheet_import_rows AS import_row
  SET matched_profile_id = p_target_profile_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.matched_profile_id = p_source_profile_id
    AND plugin_data.csf_profile_merge_import_row_disposition(
      import_row.commit_frozen_at,
      import_row.commit_target_profile_id,
      import_row.matched_profile_id,
      import_row.commit_attempt_id,
      import_row.commit_retry_count,
      import_row.commit_outcome_state,
      import_row.import_status,
      import_row.commit_outcome_resolution
    ) = 'live_rewrite';
  GET DIAGNOSTICS v_moved_import_matches = ROW_COUNT;

  UPDATE plugin_data.csf_profile_link_requests
  SET matched_profile_id = CASE WHEN matched_profile_id = p_source_profile_id THEN p_target_profile_id ELSE matched_profile_id END,
      candidate_profile_ids = array_replace(candidate_profile_ids, p_source_profile_id, p_target_profile_id),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND (
      matched_profile_id = p_source_profile_id
      OR p_source_profile_id = ANY(candidate_profile_ids)
    );

  UPDATE plugin_data.csf_profile_merge_reviews
  SET status = 'cancelled',
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled because the source profile was merged by review ' || v_review_id::text || '.'),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id <> v_review_id
    AND status = 'pending'
    AND (source_profile_id = p_source_profile_id OR target_profile_id = p_source_profile_id);

  UPDATE plugin_data.csf_profiles
  SET source_summary = coalesce(source_summary, '{}'::jsonb) || jsonb_build_object(
        'mergedProfiles',
        coalesce(source_summary->'mergedProfiles', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'profileId', v_source.id,
          'mergedAt', v_now,
          'correlationId', v_correlation_id,
          'sourceSummary', v_source.source_summary
        ))
      ),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_target_profile_id;

  UPDATE plugin_data.csf_profiles
  SET record_status = 'merged',
      merged_into_profile_id = p_target_profile_id,
      merged_at = v_now,
      merged_by = p_actor_user_id,
      merge_reason = btrim(p_reason),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_source_profile_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge',
    'csf_profiles',
    p_target_profile_id,
    jsonb_build_object(
      'targetProfileId', p_target_profile_id,
      'targetRecordStatus', v_target.record_status
    ),
    jsonb_build_object(
      'sourceProfileId', p_source_profile_id,
      'targetProfileId', p_target_profile_id,
      'reasonRecorded', true,
      'reviewId', v_review_id,
      'movedAccounts', v_moved_accounts,
      'movedRecords', v_moved_records,
      'sourceProvenancePreserved', true
    ),
    v_correlation_id,
    'duplicate_profile_merged'
  );

  RETURN jsonb_build_object(
    'sourceProfileId', p_source_profile_id,
    'targetProfileId', p_target_profile_id,
    'reviewId', v_review_id,
    'movedAccounts', v_moved_accounts,
    'movedRecords', v_moved_records,
    'importRowLiveMatches', v_moved_import_matches,
    'correlationId', v_correlation_id
  );
END;
$function$;

-- csf_purge_recovery_foundations_without_post_replies: representative
-- teardown removed; the public post-replies wrapper is restated after it.
CREATE OR REPLACE FUNCTION plugin_data.csf_purge_recovery_foundations_without_post_replies(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_durable jsonb;
  v_provider_events integer := 0;
  v_deliveries integer := 0;
  v_snapshots integer := 0;
  v_campaigns integer := 0;
  v_club_term_events integer := 0;
  v_calendar_events integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    p_organization_id::text,
    true
  );

  -- Import recovery and the sheet-source lifecycle first. Both are SELECT-only
  -- to service_role, so this is the only path that can retire them at all.
  PERFORM plugin_data.csf_purge_import_recovery(p_organization_id);

  -- Durable communications next: dispatch attempts are children of the
  -- deliveries removed below. The helper restores the flag it found, which is
  -- the flag this function just set, so the deletions that follow stay
  -- authorized.
  v_durable := plugin_data.csf_purge_durable_communications(p_organization_id);

  DELETE FROM plugin_data.csf_communication_provider_events AS provider_event
  WHERE provider_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_provider_events = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_deliveries AS delivery
  WHERE delivery.organization_id = p_organization_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_recipient_snapshots AS snapshot
  WHERE snapshot.organization_id = p_organization_id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  DELETE FROM plugin_data.csf_communication_campaigns AS campaign
  WHERE campaign.organization_id = p_organization_id;
  GET DIAGNOSTICS v_campaigns = ROW_COUNT;

  DELETE FROM plugin_data.csf_partner_club_term_events AS club_event
  WHERE club_event.organization_id = p_organization_id;
  GET DIAGNOSTICS v_club_term_events = ROW_COUNT;

  -- CSF projections only. project_schedule bindings and public.projects are
  -- deliberately out of scope: this RPC retires plugin projections, never the
  -- core scheduling records they were derived from.
  DELETE FROM public.organization_calendar_events AS calendar_event
  WHERE calendar_event.organization_id = p_organization_id
    AND calendar_event.source_kind IN (
      'csf_opportunity',
      'csf_meeting_session',
      'csf_deadline'
    );
  GET DIAGNOSTICS v_calendar_events = ROW_COUNT;

  PERFORM pg_catalog.set_config(
    'plugin_data.csf_recovery_purge_organization',
    '',
    true
  );

  -- Reproduced key for key from 20260730001003 rather than composed with `||`.
  -- The contract is the exact key set, so building it explicitly is what makes a
  -- future edit that drops or renames one a visible change instead of a
  -- side effect of what some helper happened to return.
  RETURN pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'dispatchAttempts', coalesce((v_durable->>'dispatchAttempts')::integer, 0),
    'preferenceDecisionEvents',
      coalesce((v_durable->>'preferenceDecisionEvents')::integer, 0),
    'broadcastPreferences', coalesce((v_durable->>'broadcastPreferences')::integer, 0),
    'addressSafetyEvents', coalesce((v_durable->>'addressSafetyEvents')::integer, 0),
    'addressSafetyRecords', coalesce((v_durable->>'addressSafetyRecords')::integer, 0),
    'webhookQuarantine', coalesce((v_durable->>'webhookQuarantine')::integer, 0),
    'providerEvents', v_provider_events,
    'deliveries', v_deliveries,
    'recipientSnapshots', v_snapshots,
    'campaigns', v_campaigns,
    'partnerClubTermEvents', v_club_term_events,
    'calendarProjections', v_calendar_events
  );
END;
$$;


-- Per-function privilege statements for wave 3.
--
-- The convergence block below states the same thing once, revoking from every role
-- before restoring only what the inventory marks reachable, and that is what
-- actually holds. These lines are here as well because a function whose privileges
-- are only ever set by a loop is one rename away from being silently unconverged,
-- and because the intent of each one belongs beside its definition.

CREATE OR REPLACE FUNCTION plugin_data.csf_purge_recovery_foundations(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'A CSF recovery purge requires an organization.'
      USING ERRCODE = '22004';
  END IF;

  -- Serialize against reply mutations. A mutation that already owns the lock
  -- commits first; one arriving after teardown starts cannot interleave with
  -- this delete. The later announcement delete remains RESTRICT-protected if a
  -- stale in-flight caller creates another reply after this transaction ends.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  DELETE FROM plugin_data.csf_announcement_replies AS reply
  WHERE reply.organization_id = p_organization_id;

  v_result :=
    plugin_data.csf_purge_recovery_foundations_without_post_replies(
      p_organization_id
    );
  RETURN v_result;
END;
$$;

-- csf_reconcile_sheet_import_row_identity_base: partner batch-row mirror
-- removed with the batches/rows tables.
CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(
  p_organization_id uuid,
  p_row_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_correlation_id uuid;
  v_action text;
  v_reason_code text;
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('match', 'skip') THEN
    RAISE EXCEPTION 'Import-row reconciliation decision must be match or skip.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reconciliation reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A reconciliation actor is required.';
  END IF;

  SELECT import_row.*
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  v_correlation_id := v_row.correlation_id;
  IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
    RAISE EXCEPTION 'The reconciliation correlation does not match the immutable import row.';
  END IF;

  IF p_decision = 'match' THEN
    IF p_profile_id IS NULL THEN
      RAISE EXCEPTION 'Choose the matching CSF member.';
    END IF;

    SELECT profile.*
    INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF member not found.';
    END IF;

    IF v_row.resolution_status = 'resolved'
      AND v_row.import_status = 'pending'
      AND v_row.matched_profile_id = p_profile_id
    THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'profileId', p_profile_id,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('ambiguous', 'conflict', 'duplicate') THEN
      RAISE EXCEPTION 'This row no longer needs a matching decision.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      matched_profile_id = p_profile_id,
      import_status = 'pending',
      errors = ARRAY[]::text[],
      resolution_status = 'resolved',
      resolution_reason_code = 'matched_existing_profile',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_match_resolved';
    v_reason_code := 'matched_existing_profile';
  ELSE
    IF v_row.resolution_status = 'ignored' AND v_row.import_status = 'skipped' THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('pending', 'ambiguous', 'conflict', 'duplicate', 'error') THEN
      RAISE EXCEPTION 'This row has already been imported or skipped.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      import_status = 'skipped',
      errors = ARRAY[]::text[],
      resolution_status = 'ignored',
      resolution_reason_code = 'officer_skipped',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_skipped';
    v_reason_code := 'officer_skipped';
  END IF;

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
    v_action,
    'csf_sheet_import_rows',
    v_row.id,
    v_row.term_id,
    jsonb_build_object(
      'decision', p_decision,
      'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
      'profileName', CASE
        WHEN p_decision = 'match' THEN btrim(concat_ws(' ', v_profile.first_name, v_profile.last_name))
        ELSE NULL
      END,
      'previousStatus', v_row.import_status,
      'jobId', v_row.job_id,
      'sourceId', v_row.source_id,
      'reason', p_reason
    ),
    v_correlation_id,
    'sheet_import',
    coalesce(v_row.source_id::text, v_row.job_id::text),
    v_reason_code
  );

  RETURN jsonb_build_object(
    'rowId', v_row.id,
    'decision', p_decision,
    'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

-- csf_reject_recipient_snapshot_mutation: no longer consults the dropped
-- representatives table.
CREATE OR REPLACE FUNCTION plugin_data.csf_reject_recipient_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF plugin_data.csf_recovery_teardown_authorized(OLD.organization_id) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations AS organization
      WHERE organization.id = OLD.organization_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_communication_campaigns AS campaign
      WHERE campaign.id = OLD.campaign_id
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'CSF audience snapshots cannot be deleted; use plugin_data.csf_purge_recovery_foundations().'
      USING ERRCODE = '23514';
  END IF;

  -- normalized_recipient_email is generated and is not yet recomputed in a
  -- BEFORE trigger, so recipient_email stands in for it here.
  IF ROW(
    NEW.id, NEW.organization_id, NEW.campaign_id, NEW.snapshot_version,
    NEW.recipient_email, NEW.recipient_name, NEW.subscription_decision,
    NEW.exclusion_reason, NEW.metadata, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.campaign_id, OLD.snapshot_version,
    OLD.recipient_email, OLD.recipient_name, OLD.subscription_decision,
    OLD.exclusion_reason, OLD.metadata, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    IF NEW.profile_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.id = OLD.profile_id
      )
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = OLD.user_id)
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.club_representative_id IS DISTINCT FROM OLD.club_representative_id THEN
    -- The representatives table is gone; nulling a stale historical reference
    -- is the only mutation this column can still legitimately see.
    IF NEW.club_representative_id IS NOT NULL THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.partner_club_term_id IS DISTINCT FROM OLD.partner_club_term_id THEN
    IF NEW.partner_club_term_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM plugin_data.csf_partner_club_terms AS club_term
        WHERE club_term.id = OLD.partner_club_term_id
      )
    THEN
      RAISE EXCEPTION 'CSF audience snapshots are immutable after insert.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- csf_lock_contextual_commit_population: partner half removed.
CREATE OR REPLACE FUNCTION plugin_data.csf_lock_contextual_commit_population(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_partner_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION
      'A contextual CSF commit population needs an organization.'
      USING ERRCODE = '22023';
  END IF;

  -- Partner audit batches were removed with the partner-clubs simplification;
  -- the argument survives only so the meeting-commit call site keeps its
  -- shape, and it must be NULL.
  IF p_partner_batch_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Partner audit batch commits were removed; only preview populations can be locked.'
      USING ERRCODE = '22023';
  END IF;

  IF p_preview_job_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
    ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id
    FOR UPDATE;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Simplify the partner-club schema.
-- ---------------------------------------------------------------------------

ALTER TABLE plugin_data.csf_partner_club_terms
  DROP COLUMN IF EXISTS source_batch_id,
  DROP COLUMN IF EXISTS approved_point_types,
  DROP COLUMN IF EXISTS non_drive_points,
  DROP COLUMN IF EXISTS drive_points,
  DROP COLUMN IF EXISTS proof_required,
  ADD COLUMN IF NOT EXISTS spreadsheet_url text
    CONSTRAINT csf_partner_club_terms_spreadsheet_url_shape CHECK (
      spreadsheet_url IS NULL
      OR (
        pg_catalog.length(spreadsheet_url) <= 2000
        AND spreadsheet_url ~* '^https?://'
      )
    );

COMMENT ON COLUMN plugin_data.csf_partner_club_terms.spreadsheet_url IS
  'Reference link to the club''s own member spreadsheet for this term. Owned by the club, not the chapter Google account; never read programmatically.';

ALTER TABLE plugin_data.csf_partner_clubs
  DROP COLUMN IF EXISTS approved_point_types;

-- Children first. CASCADE on the representatives drop also removes the
-- composite foreign key from csf_communication_recipient_snapshots; the
-- snapshot column itself stays as immutable ledger history.
DROP TABLE IF EXISTS plugin_data.csf_partner_submission_rows;
DROP TABLE IF EXISTS plugin_data.csf_partner_submission_batches;
DROP TABLE IF EXISTS plugin_data.csf_partner_club_representatives CASCADE;

-- Trigger functions owned by the dropped representatives table; the CASCADE
-- above removed their triggers, so the functions drop cleanly here.
DROP FUNCTION IF EXISTS plugin_data.csf_assert_representative_account_profile();

-- ---------------------------------------------------------------------------
-- D. Replace the partner policy-review implementation with the simplified
--    request shape. The permission-recheck wrapper from 20260813013200 is
--    untouched and continues to delegate here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_idempotency_key text;
  v_request_fingerprint text;
  v_existing_event plugin_data.csf_partner_club_term_events%ROWTYPE;
  v_club plugin_data.csf_partner_clubs%ROWTYPE;
  v_term_record plugin_data.csf_partner_club_terms%ROWTYPE;
  v_term_record_before plugin_data.csf_partner_club_terms%ROWTYPE;
  v_partner_club_id uuid;
  v_requested_partner_club_id uuid;
  v_returning_club_id uuid;
  v_term_id uuid;
  v_term_code text;
  v_term_status text;
  v_requested_name text;
  v_name text;
  v_contact_name text;
  v_contact_email text;
  v_president_name text;
  v_advisor_name text;
  v_continuation_status text;
  v_club_type text;
  v_recruiting_choice text;
  v_recruiting_new_members boolean;
  v_public_description text;
  v_instagram_url text;
  v_allocation_choice text;
  v_allocation_satisfied boolean;
  v_allocation_notes text;
  v_communication_method text;
  v_spreadsheet_url text;
  v_notes text;
  v_alias_value text;
  v_normalized_alias text;
  v_alias_owner uuid;
  v_partner_club_term_id uuid;
  v_previous_workflow_status text;
  v_club_before jsonb;
  v_club_after jsonb;
  v_term_before jsonb;
  v_term_after jsonb;
  v_changed boolean;
  v_term_exists boolean := false;
  v_rows integer;
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable partner-club policy request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The partner-club policy request must be an object.';
  END IF;

  BEGIN
    v_requested_partner_club_id := NULLIF(p_request ->> 'partnerClubId', '')::uuid;
    v_returning_club_id := NULLIF(p_request ->> 'returningClubId', '')::uuid;
    v_term_id := NULLIF(p_request ->> 'termId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Choose valid partner-club and semester records.';
  END;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'A semester is required.';
  END IF;

  v_term_status := NULLIF(pg_catalog.btrim(p_request ->> 'termStatus'), '');
  IF v_term_status NOT IN ('new', 'returning') THEN
    RAISE EXCEPTION 'Choose whether this club is new or returning.';
  END IF;
  IF v_term_status = 'returning' AND v_returning_club_id IS NULL THEN
    RAISE EXCEPTION 'Choose the returning club from the previous term.';
  END IF;
  IF v_term_status = 'returning'
    AND v_requested_partner_club_id IS NOT NULL
    AND v_requested_partner_club_id <> v_returning_club_id THEN
    RAISE EXCEPTION 'The edited club and returning-club record must match.';
  END IF;

  v_requested_name := NULLIF(pg_catalog.btrim(p_request ->> 'name'), '');
  IF v_term_status = 'new' AND v_requested_name IS NULL THEN
    RAISE EXCEPTION 'Partner club name is required.';
  END IF;

  v_contact_name := NULLIF(pg_catalog.btrim(p_request ->> 'contactName'), '');
  v_contact_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_request ->> 'contactEmail')), '');
  v_president_name := NULLIF(pg_catalog.btrim(p_request ->> 'presidentName'), '');
  v_advisor_name := NULLIF(pg_catalog.btrim(p_request ->> 'advisorName'), '');
  v_continuation_status := NULLIF(pg_catalog.btrim(p_request ->> 'continuationStatus'), '');
  v_club_type := NULLIF(pg_catalog.btrim(p_request ->> 'clubType'), '');
  v_public_description := NULLIF(pg_catalog.btrim(p_request ->> 'publicDescription'), '');
  v_instagram_url := NULLIF(pg_catalog.btrim(p_request ->> 'instagramUrl'), '');
  v_allocation_notes := NULLIF(pg_catalog.btrim(p_request ->> 'allocationNotes'), '');
  v_communication_method := NULLIF(pg_catalog.btrim(p_request ->> 'communicationMethod'), '');
  v_spreadsheet_url := NULLIF(pg_catalog.btrim(p_request ->> 'spreadsheetUrl'), '');
  v_notes := NULLIF(pg_catalog.btrim(p_request ->> 'notes'), '');

  IF v_spreadsheet_url IS NOT NULL
    AND (pg_catalog.length(v_spreadsheet_url) > 2000
      OR v_spreadsheet_url !~* '^https?://') THEN
    RAISE EXCEPTION 'The club spreadsheet link must be an http(s) URL.';
  END IF;

  v_recruiting_choice := coalesce(NULLIF(p_request ->> 'recruitingNewMembers', ''), 'unknown');
  IF v_recruiting_choice NOT IN ('unknown', 'yes', 'no') THEN
    RAISE EXCEPTION 'Choose a valid recruiting status.';
  END IF;
  v_recruiting_new_members := CASE v_recruiting_choice
    WHEN 'yes' THEN true
    WHEN 'no' THEN false
    ELSE NULL
  END;

  v_allocation_choice := coalesce(NULLIF(p_request ->> 'allocationSatisfied', ''), 'unknown');
  IF v_allocation_choice NOT IN ('unknown', 'yes', 'no') THEN
    RAISE EXCEPTION 'Choose a valid point-policy review status.';
  END IF;
  v_allocation_satisfied := CASE v_allocation_choice
    WHEN 'yes' THEN true
    WHEN 'no' THEN false
    ELSE NULL
  END;

  IF pg_catalog.length(coalesce(v_requested_name, '')) > 500
    OR pg_catalog.length(coalesce(v_contact_email, '')) > 320
    OR pg_catalog.length(coalesce(v_notes, '')) > 4000
    OR pg_catalog.length(coalesce(v_allocation_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Partner-club policy text is too long.';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'partnerClubId', v_requested_partner_club_id,
          'returningClubId', v_returning_club_id,
          'termId', v_term_id,
          'termStatus', v_term_status,
          'name', v_requested_name,
          'contactName', v_contact_name,
          'contactEmail', v_contact_email,
          'presidentName', v_president_name,
          'advisorName', v_advisor_name,
          'continuationStatus', v_continuation_status,
          'clubType', v_club_type,
          'recruitingNewMembers', v_recruiting_choice,
          'publicDescription', v_public_description,
          'instagramUrl', v_instagram_url,
          'allocationSatisfied', v_allocation_choice,
          'allocationNotes', v_allocation_notes,
          'communicationMethod', v_communication_method,
          'spreadsheetUrl', v_spreadsheet_url,
          'notes', v_notes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_idempotency_key := 'policy-request:' || p_request_id::text;

  -- Serializing partner-policy review at the organization boundary protects
  -- canonical names/aliases. Exact term and club rows are locked below.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_partner_club_policy:' || p_organization_id::text,
      0
    )
  );

  SELECT event.*
  INTO v_existing_event
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_event.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_event.event_type <> 'point_policy_published'
      OR v_existing_event.metadata ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That partner-club policy request identifier is already bound to a different review.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'partnerClubId', v_existing_event.metadata ->> 'partnerClubId',
      'partnerClubTermId', v_existing_event.partner_club_term_id,
      'changed', coalesce((v_existing_event.metadata ->> 'changed')::boolean, true),
      'idempotent', true,
      'requestId', p_request_id
    );
  END IF;

  SELECT term.code
  INTO v_term_code
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semester was not found.';
  END IF;

  v_partner_club_id := CASE
    WHEN v_term_status = 'returning' THEN v_returning_club_id
    ELSE v_requested_partner_club_id
  END;

  IF v_partner_club_id IS NOT NULL THEN
    SELECT club.*
    INTO v_club
    FROM plugin_data.csf_partner_clubs AS club
    WHERE club.organization_id = p_organization_id
      AND club.id = v_partner_club_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partner club was not found.';
    END IF;
    v_club_before := pg_catalog.jsonb_build_object(
      'name', v_club.name,
      'status', v_club.status,
      'allocationSatisfied', v_club.allocation_satisfied
    );
  END IF;

  IF v_term_status = 'returning' THEN
    v_name := v_club.name;
    v_contact_name := coalesce(v_contact_name, v_club.contact_name);
    v_contact_email := coalesce(v_contact_email, v_club.contact_email);
    v_president_name := coalesce(v_president_name, v_club.president_name);
    v_advisor_name := coalesce(v_advisor_name, v_club.advisor_name);
    v_continuation_status := coalesce(v_continuation_status, v_club.continuation_status, 'returning');
    v_club_type := coalesce(v_club_type, v_club.club_type);
    IF v_recruiting_choice = 'unknown' THEN
      v_recruiting_new_members := v_club.recruiting_new_members;
    END IF;
    v_public_description := coalesce(v_public_description, v_club.public_description);
    v_instagram_url := coalesce(v_instagram_url, v_club.instagram_url);
    IF v_allocation_choice = 'unknown' THEN
      v_allocation_satisfied := v_club.allocation_satisfied;
    END IF;
    v_allocation_notes := coalesce(v_allocation_notes, v_club.allocation_notes);
    v_communication_method := coalesce(v_communication_method, v_club.communication_method);
    v_notes := coalesce(v_notes, v_club.notes);
  ELSE
    v_name := v_requested_name;
    v_continuation_status := coalesce(v_continuation_status, 'new');
  END IF;

  -- The normalized alias is the cross-form canonical identity. It is checked
  -- before a new club is inserted so name collisions cannot leave orphans.
  FOR v_alias_value IN
    SELECT DISTINCT candidate.alias_value
    FROM pg_catalog.unnest(ARRAY[v_name, v_requested_name]) AS candidate(alias_value)
    WHERE NULLIF(pg_catalog.btrim(candidate.alias_value), '') IS NOT NULL
  LOOP
    v_normalized_alias := pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(v_alias_value), '\s+', ' ', 'g')
    );
    SELECT alias.partner_club_id
    INTO v_alias_owner
    FROM plugin_data.csf_partner_club_aliases AS alias
    WHERE alias.organization_id = p_organization_id
      AND alias.normalized_alias = v_normalized_alias
    FOR UPDATE;
    IF FOUND
      AND (v_partner_club_id IS NULL OR v_alias_owner <> v_partner_club_id) THEN
      RAISE EXCEPTION 'That club name or alias already belongs to another canonical partner club.';
    END IF;
  END LOOP;

  IF v_partner_club_id IS NULL THEN
    INSERT INTO plugin_data.csf_partner_clubs (
      organization_id, name, contact_name, contact_email, president_name,
      advisor_name, continuation_status, club_type, recruiting_new_members,
      public_description, instagram_url, allocation_satisfied,
      allocation_notes, communication_method, notes,
      status, created_by, created_at, updated_at
    ) VALUES (
      p_organization_id, v_name, v_contact_name, v_contact_email, v_president_name,
      v_advisor_name, v_continuation_status, v_club_type, v_recruiting_new_members,
      v_public_description, v_instagram_url, v_allocation_satisfied,
      v_allocation_notes, v_communication_method, v_notes,
      'active', p_actor_user_id, v_now, v_now
    )
    RETURNING * INTO v_club;
    v_partner_club_id := v_club.id;
    v_club_before := NULL;
  ELSE
    UPDATE plugin_data.csf_partner_clubs
    SET
      name = v_name,
      contact_name = v_contact_name,
      contact_email = v_contact_email,
      president_name = v_president_name,
      advisor_name = v_advisor_name,
      continuation_status = v_continuation_status,
      club_type = v_club_type,
      recruiting_new_members = v_recruiting_new_members,
      public_description = v_public_description,
      instagram_url = v_instagram_url,
      allocation_satisfied = v_allocation_satisfied,
      allocation_notes = v_allocation_notes,
      communication_method = v_communication_method,
      notes = v_notes,
      status = 'active',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_partner_club_id
    RETURNING * INTO v_club;
  END IF;

  v_club_after := pg_catalog.jsonb_build_object(
    'name', v_club.name,
    'status', v_club.status,
    'allocationSatisfied', v_club.allocation_satisfied
  );

  FOR v_alias_value IN
    SELECT DISTINCT candidate.alias_value
    FROM pg_catalog.unnest(ARRAY[v_name, v_requested_name]) AS candidate(alias_value)
    WHERE NULLIF(pg_catalog.btrim(candidate.alias_value), '') IS NOT NULL
  LOOP
    v_normalized_alias := pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(v_alias_value), '\s+', ' ', 'g')
    );
    INSERT INTO plugin_data.csf_partner_club_aliases (
      organization_id, partner_club_id, alias, normalized_alias, source,
      first_seen_term_id, last_seen_term_id, created_by
    ) VALUES (
      p_organization_id, v_partner_club_id, pg_catalog.btrim(v_alias_value),
      v_normalized_alias, 'staff', v_term_id, v_term_id, p_actor_user_id
    )
    ON CONFLICT (organization_id, normalized_alias) DO UPDATE
    SET
      alias = EXCLUDED.alias,
      last_seen_term_id = EXCLUDED.last_seen_term_id
    WHERE plugin_data.csf_partner_club_aliases.partner_club_id = EXCLUDED.partner_club_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'That club name or alias already belongs to another canonical partner club.';
    END IF;
  END LOOP;

  SELECT record.*
  INTO v_term_record_before
  FROM plugin_data.csf_partner_club_terms AS record
  WHERE record.organization_id = p_organization_id
    AND record.partner_club_id = v_partner_club_id
    AND record.term_id = v_term_id
  FOR UPDATE;
  v_term_exists := FOUND;

  IF v_term_exists THEN
    v_previous_workflow_status := v_term_record_before.workflow_status;
    v_term_before := pg_catalog.jsonb_build_object(
      'relationshipStatus', v_term_record_before.relationship_status,
      'workflowStatus', v_term_record_before.workflow_status,
      'allocationSatisfied', v_term_record_before.allocation_satisfied,
      'policyNotes', v_term_record_before.policy_notes,
      'spreadsheetUrl', v_term_record_before.spreadsheet_url
    );

    UPDATE plugin_data.csf_partner_club_terms
    SET
      relationship_status = v_term_status,
      workflow_status = 'active',
      allocation_satisfied = v_allocation_satisfied,
      policy_notes = v_allocation_notes,
      spreadsheet_url = v_spreadsheet_url,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_term_record_before.id
    RETURNING * INTO v_term_record;
  ELSE
    v_previous_workflow_status := NULL;
    v_term_before := NULL;
    INSERT INTO plugin_data.csf_partner_club_terms (
      organization_id, partner_club_id, term_id, relationship_status,
      workflow_status, allocation_satisfied, policy_notes, spreadsheet_url,
      reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (
      p_organization_id, v_partner_club_id, v_term_id, v_term_status,
      'active', v_allocation_satisfied, v_allocation_notes, v_spreadsheet_url,
      p_actor_user_id, v_now, v_now, v_now
    )
    RETURNING * INTO v_term_record;
  END IF;

  v_partner_club_term_id := v_term_record.id;
  v_term_after := pg_catalog.jsonb_build_object(
    'relationshipStatus', v_term_record.relationship_status,
    'workflowStatus', v_term_record.workflow_status,
    'allocationSatisfied', v_term_record.allocation_satisfied,
    'policyNotes', v_term_record.policy_notes,
    'spreadsheetUrl', v_term_record.spreadsheet_url
  );
  v_changed := v_club_before IS DISTINCT FROM v_club_after
    OR v_term_before IS DISTINCT FROM v_term_after;

  INSERT INTO plugin_data.csf_partner_club_term_events (
    organization_id, partner_club_term_id, event_type,
    previous_workflow_status, next_workflow_status, actor_user_id, reason,
    occurred_at, metadata, idempotency_key, correlation_id
  ) VALUES (
    p_organization_id, v_partner_club_term_id, 'point_policy_published',
    v_previous_workflow_status, 'active', p_actor_user_id,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'Partner-club record approved through the officer review form.'
      WHEN 'no' THEN 'Partner-club record marked as needing changes through the officer review form.'
      ELSE 'Partner-club record saved pending a completed policy review.'
    END,
    v_now,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'requestId', p_request_id,
      'partnerClubId', v_partner_club_id,
      'termId', v_term_id,
      'relationshipStatus', v_term_status,
      'allocationReview', v_allocation_choice,
      'changed', v_changed
    ),
    v_idempotency_key,
    p_request_id
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'partner_club.policy_review',
    'csf_partner_club_terms', v_partner_club_term_id, v_term_id,
    pg_catalog.jsonb_build_object('club', v_club_before, 'policy', v_term_before),
    pg_catalog.jsonb_build_object(
      'club', v_club_after,
      'policy', v_term_after,
      'changed', v_changed
    ),
    p_request_id, 'officer_decision', v_partner_club_term_id::text,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'partner_club_policy_approved'
      WHEN 'no' THEN 'partner_club_policy_needs_changes'
      ELSE 'partner_club_policy_saved'
    END
  );

  RETURN pg_catalog.jsonb_build_object(
    'partnerClubId', v_partner_club_id,
    'partnerClubTermId', v_partner_club_term_id,
    'changed', v_changed,
    'idempotent', false,
    'requestId', p_request_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_upsert_partner_club_policy_locked_impl(
  uuid, uuid, uuid, jsonb
) IS
  'Owner-only partner-club review implementation retained behind csf_upsert_partner_club_policy. Simplified 2026-08-17: no per-club point types, caps, proof requirement, or submission batches; records identity, contacts, standing, policy-review status, and the club''s own spreadsheet link.';

COMMENT ON FUNCTION plugin_data.csf_purge_recovery_foundations(uuid) IS
  'Service-role-only authorized teardown of one organization''s recovery-foundation and durable-communications records plus CSF calendar projections, child before parent. Delegates the durable-communications tables to plugin_data.csf_purge_durable_communications() first, then removes plugin_data.csf_communication_provider_events, plugin_data.csf_communication_deliveries, plugin_data.csf_communication_recipient_snapshots, plugin_data.csf_communication_campaigns, plugin_data.csf_partner_club_term_events, and finally public.organization_calendar_events restricted to source_kind IN (''csf_opportunity'', ''csf_meeting_session'', ''csf_deadline''). Returns EXACTLY these keys: organizationId, dispatchAttempts, preferenceDecisionEvents, broadcastPreferences, addressSafetyEvents, addressSafetyRecords, webhookQuarantine, providerEvents, deliveries, recipientSnapshots, campaigns, partnerClubTermEvents, calendarProjections. Never deletes public.projects or project_schedule calendar bindings.';

NOTIFY pgrst, 'reload schema';

COMMIT;
