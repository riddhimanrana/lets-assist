BEGIN;

ALTER TABLE plugin_data.csf_point_appeals
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS decision_correlation_id uuid,
  ADD COLUMN IF NOT EXISTS decision_reason_code text;

ALTER TABLE plugin_data.csf_credit_records
  ADD CONSTRAINT csf_credit_records_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE plugin_data.csf_point_appeals
  ADD CONSTRAINT csf_point_appeals_id_organization_id_key UNIQUE (id, organization_id),
  ADD CONSTRAINT csf_point_appeals_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_point_appeals_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_point_appeals_submission_organization_fkey
    FOREIGN KEY (submission_id, organization_id)
    REFERENCES plugin_data.csf_point_submissions (id, organization_id) ON DELETE SET NULL (submission_id),
  ADD CONSTRAINT csf_point_appeals_credit_organization_fkey
    FOREIGN KEY (credit_record_id, organization_id)
    REFERENCES plugin_data.csf_credit_records (id, organization_id) ON DELETE SET NULL (credit_record_id);

-- Keep the original point-review implementation as the single write engine,
-- but remove its direct service-role entrypoint. This wrapper owns lifecycle
-- and adjustment-reason validation before delegating within one transaction.
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
  v_awarded_points numeric(6,2);
BEGIN
  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point submission was not found.'; END IF;

  IF v_submission.status NOT IN ('submitted', 'needs_action') THEN
    RAISE EXCEPTION 'Only submitted or correction-requested point claims can be reviewed.';
  END IF;
  IF p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;
  IF p_action <> 'approved' AND nullif(btrim(coalesce(p_review_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A review reason is required for this decision.';
  END IF;

  v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
  IF p_action = 'approved'
    AND v_awarded_points IS DISTINCT FROM v_submission.claimed_points
    AND nullif(btrim(coalesce(p_review_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Explain why the awarded points differ from the member claim.';
  END IF;

  RETURN plugin_data.csf_review_point_submission(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    nullif(btrim(coalesce(p_review_notes, '')), ''),
    p_actor_user_id
  );
END;
$$;

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
  v_credit_id uuid;
  v_appeal_id uuid := gen_random_uuid();
  v_max_points numeric(6,2);
  v_now timestamptz := now();
BEGIN
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Explain the point appeal in at least ten characters.';
  END IF;
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal actor and correlation are required.';
  END IF;

  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point submission was not found.'; END IF;
  IF v_submission.status NOT IN ('approved', 'rejected', 'needs_action') THEN
    RAISE EXCEPTION 'This point submission is not eligible for an appeal.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_submission.profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Only the connected member may appeal this point submission.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_submission.term_id
      AND term.lifecycle_status IN ('closed', 'archived')
  ) THEN
    RAISE EXCEPTION 'This semester is closed to new point appeals.';
  END IF;

  IF p_requested_points IS NOT NULL THEN
    SELECT policy.max_points_per_activity INTO v_max_points
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id;
    IF v_max_points IS NULL THEN
      RAISE EXCEPTION 'Configure the semester policy before requesting an adjusted point award.';
    END IF;
    IF p_requested_points <= 0 OR p_requested_points > v_max_points THEN
      RAISE EXCEPTION 'Requested points must be between 0 and %.', v_max_points;
    END IF;
  END IF;

  SELECT credit.id INTO v_credit_id
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.submission_id = p_submission_id
  ORDER BY credit.created_at DESC
  LIMIT 1;

  INSERT INTO plugin_data.csf_point_appeals (
    id, organization_id, profile_id, term_id, submission_id, credit_record_id,
    reason, requested_points, status, submitted_by, correlation_id, created_at, updated_at
  ) VALUES (
    v_appeal_id, p_organization_id, v_submission.profile_id, v_submission.term_id,
    p_submission_id, v_credit_id, btrim(p_reason), p_requested_points, 'submitted',
    p_actor_user_id, p_correlation_id, v_now, v_now
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_submission.profile_id,
    'point_appeal.submit', 'csf_point_appeals', v_appeal_id, v_submission.term_id,
    NULL,
    jsonb_build_object(
      'status', 'submitted', 'submissionId', p_submission_id,
      'submissionStatus', v_submission.status, 'requestedPoints', p_requested_points
    ),
    p_correlation_id, 'point_submission', p_submission_id::text, 'member_point_appeal'
  );

  RETURN jsonb_build_object(
    'appealId', v_appeal_id,
    'submissionId', p_submission_id,
    'status', 'submitted',
    'correlationId', p_correlation_id
  );
END;
$$;

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
  v_existing_credit plugin_data.csf_credit_records%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_max_points numeric(6,2);
  v_proof jsonb := '{}'::jsonb;
  v_reason_code text;
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF nullif(btrim(coalesce(p_resolution_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A point-appeal resolution note is required.';
  END IF;
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal reviewer and correlation are required.';
  END IF;

  SELECT appeal.* INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point appeal was not found.'; END IF;
  IF v_appeal.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'This point appeal has already been decided.';
  END IF;

  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = v_appeal.submission_id
    AND submission.profile_id = v_appeal.profile_id
    AND submission.term_id = v_appeal.term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The appealed point submission was not found.'; END IF;

  IF p_decision = 'approved' THEN
    SELECT policy.max_points_per_activity INTO v_max_points
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id;
    IF v_max_points IS NULL THEN
      RAISE EXCEPTION 'Configure the semester policy before approving an appeal.';
    END IF;
    v_awarded_points := coalesce(v_appeal.requested_points, v_submission.claimed_points);
    IF v_awarded_points <= 0 OR v_awarded_points > v_max_points THEN
      RAISE EXCEPTION 'Appeal award must be between 0 and %.', v_max_points;
    END IF;

    SELECT credit.* INTO v_existing_credit
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.submission_id = v_submission.id
    ORDER BY credit.created_at DESC
    LIMIT 1
    FOR UPDATE;

    SELECT jsonb_build_object(
      'proofFileId', proof.id,
      'proofObjectPath', proof.object_path,
      'originalFilename', proof.original_filename
    ) INTO v_proof
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = v_submission.id
      AND proof.upload_status = 'finalized'
    ORDER BY proof.created_at DESC
    LIMIT 1;
    v_proof := coalesce(v_proof, '{}'::jsonb);

    INSERT INTO plugin_data.csf_credit_records (
      organization_id, profile_id, term_id, submission_id, opportunity_id,
      source, points, point_type, status, verified_by, verified_at, evidence, updated_at
    ) VALUES (
      p_organization_id, v_submission.profile_id, v_submission.term_id,
      v_submission.id, v_submission.opportunity_id, 'submission', v_awarded_points,
      v_submission.point_type, 'verified', p_actor_user_id, v_now,
      jsonb_build_object(
        'description', v_submission.description,
        'appealId', v_appeal.id,
        'appealReason', v_appeal.reason,
        'appealResolution', btrim(p_resolution_notes),
        'previousAward', v_existing_credit.points
      ) || v_proof,
      v_now
    )
    ON CONFLICT (submission_id) WHERE submission_id IS NOT NULL
    DO UPDATE SET
      points = EXCLUDED.points,
      point_type = EXCLUDED.point_type,
      status = 'verified',
      verified_by = EXCLUDED.verified_by,
      verified_at = EXCLUDED.verified_at,
      evidence = EXCLUDED.evidence,
      updated_at = EXCLUDED.updated_at;

    UPDATE plugin_data.csf_point_submissions
    SET status = 'approved', reviewed_by = p_actor_user_id, reviewed_at = v_now,
        review_notes = btrim(p_resolution_notes), updated_at = v_now
    WHERE organization_id = p_organization_id AND id = v_submission.id;

    INSERT INTO plugin_data.csf_submission_reviews (
      organization_id, submission_id, actor_user_id, action, previous_status,
      next_status, notes, details
    ) VALUES (
      p_organization_id, v_submission.id, p_actor_user_id, 'appeal_approved',
      v_submission.status, 'approved', btrim(p_resolution_notes),
      jsonb_build_object(
        'appealId', v_appeal.id,
        'previousAward', v_existing_credit.points,
        'awardedPoints', v_awarded_points
      )
    );
  END IF;

  v_reason_code := CASE p_decision
    WHEN 'approved' THEN CASE
      WHEN v_appeal.requested_points IS DISTINCT FROM v_submission.claimed_points
        THEN 'point_appeal_adjusted'
      ELSE 'point_appeal_approved'
    END
    WHEN 'rejected' THEN 'point_appeal_rejected'
    ELSE 'point_appeal_under_review'
  END;

  UPDATE plugin_data.csf_point_appeals
  SET status = p_decision, reviewed_by = p_actor_user_id,
      reviewed_at = CASE WHEN p_decision = 'under_review' THEN NULL ELSE v_now END,
      resolution_notes = btrim(p_resolution_notes), updated_at = v_now,
      decision_correlation_id = p_correlation_id,
      decision_reason_code = v_reason_code,
      credit_record_id = CASE
        WHEN p_decision = 'approved' THEN (
          SELECT credit.id FROM plugin_data.csf_credit_records AS credit
          WHERE credit.organization_id = p_organization_id
            AND credit.submission_id = v_submission.id
          ORDER BY credit.created_at DESC LIMIT 1
        )
        ELSE credit_record_id
      END
  WHERE organization_id = p_organization_id AND id = p_appeal_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_appeal.profile_id,
    'point_appeal.' || p_decision, 'csf_point_appeals', p_appeal_id, v_appeal.term_id,
    jsonb_build_object(
      'appealStatus', v_appeal.status,
      'submissionStatus', v_submission.status,
      'previousAward', v_existing_credit.points
    ),
    jsonb_build_object(
      'appealStatus', p_decision,
      'submissionStatus', CASE WHEN p_decision = 'approved' THEN 'approved' ELSE v_submission.status END,
      'awardedPoints', CASE WHEN p_decision = 'approved' THEN v_awarded_points ELSE NULL END,
      'resolutionNotes', btrim(p_resolution_notes)
    ),
    p_correlation_id, 'point_appeal', p_appeal_id::text, v_reason_code
  );

  RETURN jsonb_build_object(
    'appealId', p_appeal_id,
    'submissionId', v_submission.id,
    'status', p_decision,
    'awardedPoints', CASE WHEN p_decision = 'approved' THEN v_awarded_points ELSE NULL END,
    'correlationId', p_correlation_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid)
  FROM service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(uuid, uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_point_appeal(uuid, uuid, text, numeric, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal(uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(uuid, uuid, text, numeric, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_point_appeal(uuid, uuid, text, numeric, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_appeal(uuid, uuid, text, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_review_point_submission_v2(uuid, uuid, text, numeric, text, uuid) IS
  'Validates point-review lifecycle and adjustment reasons before executing the atomic submission review.';
COMMENT ON FUNCTION plugin_data.csf_submit_point_appeal(uuid, uuid, text, numeric, uuid, uuid) IS
  'Atomically creates one member point appeal and its immutable correlated audit event.';
COMMENT ON FUNCTION plugin_data.csf_review_point_appeal(uuid, uuid, text, text, uuid, uuid) IS
  'Atomically resolves a point appeal, creates or adjusts the award, updates the submission, and audits the decision.';

NOTIFY pgrst, 'reload schema';

COMMIT;
