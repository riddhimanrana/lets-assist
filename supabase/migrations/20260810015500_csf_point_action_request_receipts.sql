-- Make every interactive CSF point mutation replay-safe after a lost response.
-- The preceding authority migration remains the source of final policy and
-- permission revalidation. These request entrypoints add stable intent,
-- immutable receipts, and exact-current-state replay on top of those engines.

BEGIN;

CREATE UNIQUE INDEX csf_admin_audit_events_point_action_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND source_type = 'point_action_request'
    AND action IN (
      'point_submission.begin_request_committed',
      'point_submission.withdraw_request_committed',
      'point_submission.resubmit_request_committed',
      'point_submission.review_request_committed',
      'point_appeal.submit_request_committed',
      'point_appeal.review_request_committed'
    );

CREATE UNIQUE INDEX csf_admin_audit_events_point_proof_finalize_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND source_type = 'point_proof_finalize_request'
    AND action = 'point_submission.proof_finalize_request_committed';

CREATE UNIQUE INDEX csf_admin_audit_events_point_proof_fail_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND source_type = 'point_proof_fail_request'
    AND action = 'point_submission.proof_fail_request_committed';

-- A receipt never stores free-form student content or proof coordinates.
-- These helpers reduce current state to opaque identifiers, typed lifecycle
-- values, quantities, and hashes of any free-form/private fields.
CREATE FUNCTION plugin_data.csf_point_submission_receipt_state(
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
          'approvedPointTypes', club_term.approved_point_types,
          'nonDrivePoints', club_term.non_drive_points,
          'drivePoints', club_term.drive_points,
          'proofRequired', club_term.proof_required,
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

CREATE FUNCTION plugin_data.csf_point_appeal_receipt_state(
  p_organization_id uuid,
  p_appeal_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'appealId', appeal.id,
    'organizationId', appeal.organization_id,
    'profileId', appeal.profile_id,
    'termId', appeal.term_id,
    'submissionId', appeal.submission_id,
    'creditRecordId', appeal.credit_record_id,
    'reasonDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(appeal.reason, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'requestedPoints', appeal.requested_points,
    'status', appeal.status,
    'submittedBy', appeal.submitted_by,
    'reviewedBy', appeal.reviewed_by,
    'reviewedAtEpoch', CASE
      WHEN appeal.reviewed_at IS NULL THEN NULL
      ELSE extract(epoch FROM appeal.reviewed_at)
    END,
    'resolutionDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(appeal.resolution_notes, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'correlationId', appeal.correlation_id,
    'decisionCorrelationId', appeal.decision_correlation_id,
    'decisionReasonCode', appeal.decision_reason_code,
    'createdAtEpoch', extract(epoch FROM appeal.created_at),
    'updatedAtEpoch', extract(epoch FROM appeal.updated_at),
    'submissionState', plugin_data.csf_point_submission_receipt_state(
      appeal.organization_id,
      appeal.submission_id
    )
  )
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_point_submission_receipt_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_point_appeal_receipt_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_point_request_fingerprint(
  p_operation text,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_intent jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation', p_operation,
          'organizationId', p_organization_id,
          'actorUserId', p_actor_user_id,
          'intent', p_intent
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_point_request_fingerprint(
  text, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION plugin_data.csf_begin_point_submission_request(
  p_organization_id uuid,
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
  p_file_original_filename text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_proof_sha256 text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_source, '')));
  v_original_filename text := nullif(
    pg_catalog.btrim(coalesce(p_file_original_filename, '')),
    ''
  );
  v_mime_type text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_file_mime_type, ''))
  );
  v_proof_sha256 text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_proof_sha256, ''))
  );
  v_has_proof boolean;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_finalize_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_fail_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_proof plugin_data.csf_submission_files%ROWTYPE;
  v_submission_id uuid;
  v_file_id uuid;
  v_upload_token uuid;
  v_object_path text;
  v_begin_state jsonb;
  v_current_state jsonb;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-submission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF v_source NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'Interactive point submissions must use a student or staff source.';
  END IF;

  v_has_proof := v_original_filename IS NOT NULL
    OR v_mime_type <> ''
    OR p_file_size_bytes IS NOT NULL
    OR v_proof_sha256 <> '';
  IF v_has_proof THEN
    IF v_original_filename IS NULL
      OR pg_catalog.length(v_original_filename) > 255
      OR v_mime_type NOT IN (
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'
      )
      OR p_file_size_bytes IS NULL
      OR p_file_size_bytes <= 0
      OR p_file_size_bytes > 10485760
      OR v_proof_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Validated proof metadata and digest are required together.';
    END IF;
  ELSE
    v_original_filename := NULL;
    v_mime_type := NULL;
    v_proof_sha256 := NULL;
  END IF;

  -- Current authorization is required before any request receipt is read.
  IF v_source = 'staff' THEN
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
      AND account.status = 'verified'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point claim.';
    END IF;
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'profileId', p_profile_id,
    'termId', p_term_id,
    'opportunityId', p_opportunity_id,
    'partnerClubTermId', p_partner_club_term_id,
    'source', v_source,
    'description', v_description,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'hasProof', v_has_proof,
    'proofFilename', v_original_filename,
    'proofMimeType', v_mime_type,
    'proofSizeBytes', p_file_size_bytes,
    'proofSha256', v_proof_sha256
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'begin_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.begin_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_point_submissions'
      OR v_receipt.target_id IS NULL
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;

    SELECT submission.*
    INTO v_submission
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.organization_id = p_organization_id
      AND submission.id = v_receipt.target_id
      AND submission.profile_id = p_profile_id
      AND submission.term_id = p_term_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The committed point-submission receipt no longer resolves to its claim.';
    END IF;

    v_current_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      v_submission.id
    );
    IF v_has_proof THEN
      BEGIN
        v_file_id := (v_receipt.after_data ->> 'fileId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'The committed point-proof receipt is invalid.';
      END;
      SELECT proof.*
      INTO v_proof
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.id = v_file_id
        AND proof.uploaded_by = p_actor_user_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The committed point-proof receipt no longer resolves to its proof.';
      END IF;

      IF v_submission.status = 'draft' AND v_proof.upload_status = 'pending' THEN
        IF v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The pending point submission changed. Ask a CSF officer to reconcile it before retrying.';
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
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'pending',
          'objectPath', v_proof.object_path,
          'uploadToken', v_proof.upload_token,
          'proofSha256', v_proof_sha256,
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_finalize_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_finalize_request'
        AND audit.action = 'point_submission.proof_finalize_request_committed'
      LIMIT 1;
      IF v_submission.status = 'submitted'
        AND v_proof.upload_status = 'finalized'
        AND FOUND THEN
        IF v_finalize_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_finalize_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_finalize_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The finalized point submission changed. Reload Point submissions.';
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
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'submitted',
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_fail_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_fail_request'
        AND audit.action = 'point_submission.proof_fail_request_committed'
      LIMIT 1;
      IF v_submission.status = 'withdrawn'
        AND v_proof.upload_status = 'failed'
        AND FOUND THEN
        IF v_fail_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_fail_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_fail_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The failed point submission changed. Ask a CSF officer to reconcile it.';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'failed',
          'idempotent', true
        );
      END IF;
      RAISE EXCEPTION 'The committed point-proof request has a stale lifecycle state.';
    END IF;

    IF v_submission.status IS DISTINCT FROM 'submitted'
      OR v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
      RAISE EXCEPTION 'The committed point submission is no longer current. Reload Point submissions.';
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
      false,
      false,
      false
    );
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', v_submission.id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  -- Internal coordinates are generated only after proving this request has no
  -- prior receipt. A retry can therefore never fork a second proof path.
  v_submission_id := pg_catalog.gen_random_uuid();
  IF v_has_proof THEN
    v_file_id := pg_catalog.gen_random_uuid();
    v_upload_token := pg_catalog.gen_random_uuid();
    v_object_path := 'organizations/' || p_organization_id::text
      || '/profiles/' || p_profile_id::text
      || '/terms/' || p_term_id::text
      || '/submissions/' || v_submission_id::text
      || '/' || pg_catalog.gen_random_uuid()::text || '-proof';
  END IF;

  PERFORM plugin_data.csf_begin_point_submission(
    p_organization_id,
    v_submission_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    v_source,
    v_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    v_file_id,
    CASE WHEN v_has_proof THEN 'csf-private' ELSE NULL END,
    v_object_path,
    v_original_filename,
    v_mime_type,
    p_file_size_bytes,
    v_upload_token,
    p_request_id
  );

  v_begin_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    v_submission_id
  );
  IF v_begin_state IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create a canonical claim.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.target_id = v_submission_id
    AND audit.source_type = 'point_submission'
    AND audit.action IN ('point_submission.create', 'point_submission.proof_pending')
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    p_profile_id,
    'point_submission.begin_request_committed',
    'csf_point_submissions',
    v_submission_id,
    p_term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'begin_submission',
      'requestFingerprint', v_request_fingerprint,
      'proofDigest', v_proof_sha256,
      'fileId', v_file_id,
      'canonicalAuditId', v_canonical_audit_id,
      'beginState', v_begin_state
    ),
    p_request_id,
    'point_action_request',
    v_submission_id::text,
    'point_submission_begin_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', v_submission_id,
    'fileId', v_file_id,
    'status', CASE WHEN v_has_proof THEN 'pending' ELSE 'submitted' END,
    'objectPath', v_object_path,
    'uploadToken', v_upload_token,
    'proofSha256', v_proof_sha256,
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_submit_point_appeal_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_reason text,
  p_requested_points numeric,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
  v_appeal_id uuid;
  v_state jsonb;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-appeal request identifier is required.';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 10
    OR pg_catalog.length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal reason must contain between 10 and 2000 characters.';
  END IF;

  -- Reauthorize the active organization member and verified profile owner
  -- before reading either the private claim or a request receipt.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
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

  v_intent := pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'reason', v_reason,
    'requestedPoints', p_requested_points
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'submit_appeal',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_appeal.submit_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.source_id IS DISTINCT FROM p_submission_id::text
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    BEGIN
      v_appeal_id := (v_receipt.after_data ->> 'appealId')::uuid;
      v_canonical_audit_id := (v_receipt.after_data ->> 'canonicalAuditId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The point-appeal receipt is malformed.';
    END;
    v_state := plugin_data.csf_point_appeal_receipt_state(
      p_organization_id,
      v_appeal_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'The submitted point appeal is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = v_canonical_audit_id
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_appeal.submit'
        AND audit.target_id = v_appeal_id
    ) THEN
      RAISE EXCEPTION 'The point-appeal receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'appealId', v_appeal_id,
      'submissionId', p_submission_id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  v_result := plugin_data.csf_submit_point_appeal(
    p_organization_id,
    p_submission_id,
    v_reason,
    p_requested_points,
    p_actor_user_id,
    p_request_id
  );
  BEGIN
    v_appeal_id := (v_result ->> 'appealId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Point-appeal submission returned invalid canonical evidence.';
  END;
  v_state := plugin_data.csf_point_appeal_receipt_state(
    p_organization_id,
    v_appeal_id
  );
  IF v_appeal_id IS NULL
    OR v_state ->> 'submissionId' IS DISTINCT FROM p_submission_id::text
    OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Point-appeal submission did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_appeal.submit'
    AND audit.target_id = v_appeal_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal submission did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_appeal.submit_request_committed',
    'csf_point_appeals',
    v_appeal_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'submit_appeal',
      'requestFingerprint', v_request_fingerprint,
      'appealId', v_appeal_id,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_appeal_submit_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'appealId', v_appeal_id,
    'submissionId', p_submission_id,
    'status', 'submitted',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_review_point_appeal_request(
  p_organization_id uuid,
  p_appeal_id uuid,
  p_decision text,
  p_resolution_notes text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision, '')));
  v_resolution_notes text := nullif(
    pg_catalog.btrim(coalesce(p_resolution_notes, '')),
    ''
  );
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-appeal review request identifier is required.';
  END IF;
  IF v_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF v_resolution_notes IS NULL
    OR pg_catalog.length(v_resolution_notes) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal resolution notes must contain between 1 and 2000 characters.';
  END IF;

  -- Reviewer permission is locked before private appeal or receipt data.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['process_points']::text[]
  );
  SELECT appeal.*
  INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point appeal was not found.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'appealId', p_appeal_id,
    'decision', v_decision,
    'resolutionNotes', v_resolution_notes
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'review_appeal',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_appeal.review_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_appeal_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_appeal_receipt_state(
      p_organization_id,
      p_appeal_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM v_decision THEN
      RAISE EXCEPTION 'The reviewed point appeal is no longer current. Reload Point submissions.';
    END IF;
    BEGIN
      v_canonical_audit_id := (v_receipt.after_data ->> 'canonicalAuditId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The point-appeal review receipt is malformed.';
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = v_canonical_audit_id
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_appeal.' || v_decision
        AND audit.target_id = p_appeal_id
    ) THEN
      RAISE EXCEPTION 'The point-appeal review receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'appealId', p_appeal_id,
      'submissionId', v_state ->> 'submissionId',
      'status', v_decision,
      'awardedPoints', v_receipt.after_data -> 'awardedPoints',
      'idempotent', true
    );
  END IF;

  v_result := plugin_data.csf_review_point_appeal(
    p_organization_id,
    p_appeal_id,
    v_decision,
    v_resolution_notes,
    p_actor_user_id,
    p_request_id
  );
  v_state := plugin_data.csf_point_appeal_receipt_state(
    p_organization_id,
    p_appeal_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM v_decision THEN
    RAISE EXCEPTION 'Point-appeal review did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_appeal.' || v_decision
    AND audit.target_id = p_appeal_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal review did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_appeal.profile_id,
    'point_appeal.review_request_committed',
    'csf_point_appeals',
    p_appeal_id,
    v_appeal.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'review_appeal',
      'requestFingerprint', v_request_fingerprint,
      'canonicalAuditId', v_canonical_audit_id,
      'awardedPoints', v_result -> 'awardedPoints',
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_appeal_id::text,
    'point_appeal_review_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'appealId', p_appeal_id,
    'submissionId', v_state ->> 'submissionId',
    'status', v_decision,
    'awardedPoints', v_result -> 'awardedPoints',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_finalize_point_submission_proof_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_file_id uuid,
  p_upload_token uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_proof plugin_data.csf_submission_files%ROWTYPE;
  v_begin_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_state jsonb;
  v_result jsonb;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_submission_id IS NULL OR p_file_id IS NULL
    OR p_upload_token IS NULL THEN
    RAISE EXCEPTION 'Point-proof finalization identity is incomplete.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_submission.profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer finalize this proof.';
    END IF;
  ELSIF v_submission.source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    RAISE EXCEPTION 'This point source cannot use interactive proof finalization.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_begin_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
    AND audit.action = 'point_submission.begin_request_committed'
    AND audit.target_id = p_submission_id
    AND audit.actor_user_id = p_actor_user_id
    AND audit.after_data ->> 'fileId' = p_file_id::text
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point-proof finalization does not match an authorized begin request.';
  END IF;

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_proof_finalize_request'
    AND audit.action = 'point_submission.proof_finalize_request_committed'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'fileId' IS DISTINCT FROM p_file_id::text THEN
      RAISE EXCEPTION 'That proof request identifier is bound to a different finalization.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state THEN
      RAISE EXCEPTION 'The finalized point submission is no longer current. Reload Point submissions.';
    END IF;
    SELECT proof.*
    INTO v_proof
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.id = p_file_id
      AND proof.upload_token = p_upload_token
      AND proof.uploaded_by = p_actor_user_id
    FOR SHARE;
    IF NOT FOUND OR v_proof.upload_status <> 'finalized'
      OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'The finalized point submission is no longer current.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = p_request_id
        AND audit.target_id = p_submission_id
        AND audit.action = 'point_submission.create'
        AND audit.reason_code = 'point_proof_upload_finalized'
    ) THEN
      RAISE EXCEPTION 'The proof-finalization receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'fileId', p_file_id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.source_type = 'point_proof_fail_request'
      AND audit.action = 'point_submission.proof_fail_request_committed'
  ) THEN
    RAISE EXCEPTION 'This proof request already committed a failed cleanup outcome.';
  END IF;

  v_result := plugin_data.csf_finalize_point_submission_proof(
    p_organization_id,
    p_submission_id,
    p_file_id,
    p_upload_token,
    p_actor_user_id
  );
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Point-proof finalization did not submit the claim.';
  END IF;

  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.target_id = p_submission_id
    AND audit.source_type = 'point_submission'
    AND audit.action = 'point_submission.create'
    AND audit.reason_code = 'point_proof_upload_finalized'
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-proof finalization did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.proof_finalize_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'finalize_proof',
      'fileId', p_file_id,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state
    ),
    p_request_id,
    'point_proof_finalize_request',
    p_submission_id::text,
    'point_proof_finalize_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', 'submitted',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_fail_point_submission_proof_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_file_id uuid,
  p_upload_token uuid,
  p_actor_user_id uuid,
  p_error text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_proof plugin_data.csf_submission_files%ROWTYPE;
  v_begin_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_state jsonb;
  v_result jsonb;
  v_canonical_audit_id uuid;
  v_error text := pg_catalog.left(
    coalesce(nullif(pg_catalog.btrim(p_error), ''), 'Proof upload did not complete.'),
    1000
  );
BEGIN
  IF p_request_id IS NULL OR p_submission_id IS NULL OR p_file_id IS NULL
    OR p_upload_token IS NULL THEN
    RAISE EXCEPTION 'Point-proof cleanup identity is incomplete.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_submission.profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer reconcile this proof.';
    END IF;
  ELSIF v_submission.source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    RAISE EXCEPTION 'This point source cannot use interactive proof cleanup.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_begin_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
    AND audit.action = 'point_submission.begin_request_committed'
    AND audit.target_id = p_submission_id
    AND audit.actor_user_id = p_actor_user_id
    AND audit.after_data ->> 'fileId' = p_file_id::text
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point-proof cleanup does not match an authorized begin request.';
  END IF;

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_proof_fail_request'
    AND audit.action = 'point_submission.proof_fail_request_committed'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'fileId' IS DISTINCT FROM p_file_id::text THEN
      RAISE EXCEPTION 'That proof request identifier is bound to a different cleanup.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state THEN
      RAISE EXCEPTION 'The failed point submission is no longer current. Ask a CSF officer to reconcile it.';
    END IF;
    SELECT proof.*
    INTO v_proof
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.id = p_file_id
      AND proof.upload_token = p_upload_token
      AND proof.uploaded_by = p_actor_user_id
      AND proof.upload_status = 'failed'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The failed proof identity is invalid or no longer current.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = p_request_id
        AND audit.target_id = p_submission_id
        AND audit.action = 'point_submission.proof_failed'
        AND audit.reason_code = 'point_proof_upload_failed'
    ) THEN
      RAISE EXCEPTION 'The proof-cleanup receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'fileId', p_file_id,
      'status', 'failed',
      'idempotent', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.source_type = 'point_proof_finalize_request'
      AND audit.action = 'point_submission.proof_finalize_request_committed'
  ) THEN
    RAISE EXCEPTION 'This proof request already committed a finalized submission.';
  END IF;

  v_result := plugin_data.csf_fail_point_submission_proof(
    p_organization_id,
    p_submission_id,
    p_file_id,
    p_upload_token,
    p_actor_user_id,
    v_error
  );
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'withdrawn' THEN
    RAISE EXCEPTION 'Point-proof cleanup did not withdraw the draft claim.';
  END IF;

  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.target_id = p_submission_id
    AND audit.source_type = 'point_submission'
    AND audit.action = 'point_submission.proof_failed'
    AND audit.reason_code = 'point_proof_upload_failed'
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-proof cleanup did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.proof_fail_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'fail_proof',
      'fileId', p_file_id,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state
    ),
    p_request_id,
    'point_proof_fail_request',
    p_submission_id::text,
    'point_proof_fail_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', 'failed',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_withdraw_point_submission_request(
  p_organization_id uuid,
  p_profile_id uuid,
  p_submission_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_correlation_id uuid;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-withdrawal request identifier is required.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  PERFORM 1
  FROM plugin_data.csf_point_submissions AS submission
  JOIN plugin_data.csf_profile_accounts AS account
    ON account.organization_id = submission.organization_id
   AND account.profile_id = submission.profile_id
   AND account.user_id = p_actor_user_id
   AND account.status = 'verified'
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
    AND submission.profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may withdraw this point submission.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'profileId', p_profile_id,
    'submissionId', p_submission_id
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'withdraw_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.withdraw_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM 'withdrawn' THEN
      RAISE EXCEPTION 'The withdrawn point submission is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = (v_receipt.after_data ->> 'canonicalCorrelationId')::uuid
        AND audit.action = 'point_submission.withdraw'
        AND audit.target_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'The withdrawn point-submission receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', 'withdrawn',
      'idempotent', true
    );
  END IF;

  v_result := plugin_data.csf_withdraw_point_submission(
    p_organization_id,
    p_profile_id,
    p_submission_id,
    p_actor_user_id
  );
  BEGIN
    v_canonical_correlation_id := (v_result ->> 'correlationId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Point withdrawal returned invalid canonical evidence.';
  END;
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'withdrawn' THEN
    RAISE EXCEPTION 'Point withdrawal did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = v_canonical_correlation_id
    AND audit.action = 'point_submission.withdraw'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point withdrawal did not create canonical audit evidence.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    p_profile_id,
    'point_submission.withdraw_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'withdraw_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalCorrelationId', v_canonical_correlation_id,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_withdraw_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', 'withdrawn',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_resubmit_point_submission_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_claimed_points numeric,
  p_point_type text,
  p_activity_date date,
  p_description text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_audit_id uuid;
  v_has_finalized_proof boolean := false;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-resubmission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
    AND submission.source = 'student'
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = submission.organization_id
        AND account.profile_id = submission.profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may correct and resubmit this point submission.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'description', v_description
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'resubmit_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.resubmit_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'The resubmitted point claim is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_submission.resubmit'
        AND audit.target_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'The resubmission receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', 'submitted',
      'idempotent', true
    );
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
    p_claimed_points,
    p_point_type,
    v_has_finalized_proof,
    false,
    false
  );

  v_result := plugin_data.csf_resubmit_point_submission(
    p_organization_id,
    p_submission_id,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    v_description,
    p_actor_user_id,
    p_request_id
  );
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Point resubmission did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_submission.resubmit'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point resubmission did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.resubmit_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'resubmit_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_resubmit_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', 'submitted',
    'idempotent', false
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_review_point_submission_request(
  p_organization_id uuid,
  p_submission_id uuid,
  p_action text,
  p_awarded_points numeric,
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
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_review_notes text := nullif(
    pg_catalog.btrim(coalesce(p_review_notes, '')),
    ''
  );
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_correlation_id uuid;
  v_canonical_audit_id uuid;
  v_review_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-review request identifier is required.';
  END IF;
  IF v_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;
  IF pg_catalog.length(coalesce(v_review_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Point-review notes must be 4000 characters or fewer.';
  END IF;

  -- Reviewer authority is resolved before private submission or receipt data.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'action', v_action,
    'awardedPoints', p_awarded_points,
    'reviewNotes', v_review_notes
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'review_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.review_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM v_action THEN
      RAISE EXCEPTION 'The reviewed point submission is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = (v_receipt.after_data ->> 'canonicalCorrelationId')::uuid
        AND audit.action = 'point_submission.review'
        AND audit.target_id = p_submission_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = p_organization_id
        AND review.id = (v_receipt.after_data ->> 'reviewId')::uuid
        AND review.submission_id = p_submission_id
        AND review.action = v_action
    ) THEN
      RAISE EXCEPTION 'The point-review receipt is missing canonical review evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', v_action,
      'awardedPoints', v_receipt.after_data -> 'awardedPoints',
      'idempotent', true
    );
  END IF;

  -- A correction-requested claim is member-owned until resubmission. It must
  -- never be reviewed a second time while still needs_action.
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted point claim can be reviewed. A correction-requested claim must be resubmitted by the member first.';
  END IF;

  v_result := plugin_data.csf_review_point_submission_v2(
    p_organization_id,
    p_submission_id,
    v_action,
    p_awarded_points,
    v_review_notes,
    p_actor_user_id
  );
  BEGIN
    v_canonical_correlation_id := (v_result ->> 'correlationId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Point review returned invalid canonical evidence.';
  END;
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM v_action THEN
    RAISE EXCEPTION 'Point review did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = v_canonical_correlation_id
    AND audit.action = 'point_submission.review'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  SELECT review.id
  INTO v_review_id
  FROM plugin_data.csf_submission_reviews AS review
  WHERE review.organization_id = p_organization_id
    AND review.submission_id = p_submission_id
    AND review.action = v_action
    AND review.details ->> 'correlationId' = v_canonical_correlation_id::text
  ORDER BY review.created_at DESC, review.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL OR v_review_id IS NULL THEN
    RAISE EXCEPTION 'Point review did not create canonical review evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.review_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'review_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalCorrelationId', v_canonical_correlation_id,
      'canonicalAuditId', v_canonical_audit_id,
      'reviewId', v_review_id,
      'awardedPoints', v_result -> 'awardedPoints',
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_review_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', v_action,
    'awardedPoints', v_result -> 'awardedPoints',
    'idempotent', false
  );
END;
$$;

-- The request-aware entrypoints are now the only service-role point writers.
-- Owner-only engines remain callable by these SECURITY DEFINER wrappers.
REVOKE EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_finalize_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_fail_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid, text
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_withdraw_point_submission(
  uuid, uuid, uuid, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_submit_point_appeal(
  uuid, uuid, text, numeric, uuid, uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) FROM service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_fail_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_withdraw_point_submission_request(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_request(
  uuid, uuid, text, numeric, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_point_appeal_request(
  uuid, uuid, text, numeric, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal_request(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_withdraw_point_submission_request(
  uuid, uuid, uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_request(
  uuid, uuid, text, numeric, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_point_appeal_request(
  uuid, uuid, text, numeric, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_appeal_request(
  uuid, uuid, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) IS
  'Service-only request boundary for replay-safe point-claim creation. It creates proof coordinates only on a receipt miss and binds them to a validated content digest.';
COMMENT ON FUNCTION plugin_data.csf_finalize_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, uuid
) IS
  'Service-only replay-safe proof finalizer. It reauthorizes before reading receipts and returns no storage coordinate.';
COMMENT ON FUNCTION plugin_data.csf_fail_point_submission_proof_request(
  uuid, uuid, uuid, uuid, uuid, text, uuid
) IS
  'Service-only replay-safe proof cleanup marker for one begin request.';
COMMENT ON FUNCTION plugin_data.csf_withdraw_point_submission_request(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Service-only replay-safe member point-claim withdrawal boundary.';
COMMENT ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) IS
  'Service-only replay-safe member correction resubmission boundary.';
COMMENT ON FUNCTION plugin_data.csf_review_point_submission_request(
  uuid, uuid, text, numeric, text, uuid, uuid
) IS
  'Service-only replay-safe point-review boundary. Only submitted claims are reviewable; needs-action claims must first be resubmitted by the member.';
COMMENT ON FUNCTION plugin_data.csf_submit_point_appeal_request(
  uuid, uuid, text, numeric, uuid, uuid
) IS
  'Service-only replay-safe member point-appeal submission boundary.';
COMMENT ON FUNCTION plugin_data.csf_review_point_appeal_request(
  uuid, uuid, text, text, uuid, uuid
) IS
  'Service-only replay-safe staff point-appeal decision boundary.';

NOTIFY pgrst, 'reload schema';

COMMIT;
