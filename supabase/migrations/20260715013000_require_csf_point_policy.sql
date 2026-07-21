BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_submission(
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
  v_previous_status text;
  v_awarded_points numeric(6,2);
  v_max_points numeric(6,2);
  v_proof jsonb := '{}'::jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
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

  v_previous_status := v_submission.status;
  v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);

  IF p_action = 'approved' THEN
    SELECT policy.max_points_per_activity
    INTO v_max_points
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A saved semester policy is required before approving point submissions.';
    END IF;

    IF v_awarded_points IS NULL OR v_awarded_points <= 0 OR v_awarded_points > v_max_points THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.', v_max_points;
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'proofFileId', proof.id,
    'proofObjectPath', proof.object_path,
    'originalFilename', proof.original_filename
  )
  INTO v_proof
  FROM plugin_data.csf_submission_files AS proof
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
  ORDER BY proof.created_at DESC
  LIMIT 1;
  v_proof := coalesce(v_proof, '{}'::jsonb);

  UPDATE plugin_data.csf_point_submissions
  SET
    status = p_action,
    reviewed_by = p_actor_user_id,
    reviewed_at = v_now,
    review_notes = p_review_notes,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_submission_id;

  IF p_action = 'approved' THEN
    INSERT INTO plugin_data.csf_credit_records (
      organization_id,
      profile_id,
      term_id,
      submission_id,
      opportunity_id,
      source,
      points,
      point_type,
      status,
      verified_by,
      verified_at,
      evidence,
      updated_at
    ) VALUES (
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.id,
      v_submission.opportunity_id,
      'submission',
      v_awarded_points,
      v_submission.point_type,
      'verified',
      p_actor_user_id,
      v_now,
      jsonb_build_object(
        'description', v_submission.description,
        'sourceSubmissionId', v_submission.id,
        'correlationId', v_correlation_id
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
  ELSE
    UPDATE plugin_data.csf_credit_records
    SET
      status = CASE WHEN p_action = 'needs_action' THEN 'pending' ELSE 'rejected' END,
      verified_by = p_actor_user_id,
      verified_at = v_now,
      evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('correlationId', v_correlation_id),
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND submission_id = p_submission_id;
  END IF;

  INSERT INTO plugin_data.csf_submission_reviews (
    organization_id,
    submission_id,
    actor_user_id,
    action,
    previous_status,
    next_status,
    notes,
    details
  ) VALUES (
    p_organization_id,
    p_submission_id,
    p_actor_user_id,
    p_action,
    v_previous_status,
    p_action,
    p_review_notes,
    jsonb_build_object(
      'claimedPoints', v_submission.claimed_points,
      'awardedPoints', CASE WHEN p_action = 'approved' THEN v_awarded_points ELSE NULL END,
      'correlationId', v_correlation_id,
      'sourceSubmissionId', v_submission.id
    ) || v_proof
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
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
    'point_submission.review',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object(
      'status', p_action,
      'claimedPoints', v_submission.claimed_points,
      'awardedPoints', CASE WHEN p_action = 'approved' THEN v_awarded_points ELSE NULL END
    ) || v_proof,
    v_correlation_id,
    'point_submission',
    p_submission_id::text,
    CASE p_action
      WHEN 'approved' THEN 'point_submission_approved'
      WHEN 'needs_action' THEN 'point_submission_correction_requested'
      WHEN 'duplicate' THEN 'point_submission_marked_duplicate'
      ELSE 'point_submission_rejected'
    END
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'previousStatus', v_previous_status,
    'status', p_action,
    'awardedPoints', CASE WHEN p_action = 'approved' THEN v_awarded_points ELSE NULL END,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid) IS
  'Atomically applies a CSF point-submission decision, enforces the saved term policy for approval, and records correlated credit, review, and audit evidence.';

NOTIFY pgrst, 'reload schema';

COMMIT;
