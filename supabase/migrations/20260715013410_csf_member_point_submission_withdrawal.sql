BEGIN;

CREATE FUNCTION plugin_data.csf_withdraw_point_submission(
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
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
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

  IF v_submission.submitted_by IS DISTINCT FROM p_actor_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = p_profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    ) THEN
    RAISE EXCEPTION 'You can only withdraw your own point submission.';
  END IF;

  IF v_submission.status <> 'submitted'
    OR v_submission.reviewed_by IS NOT NULL
    OR v_submission.reviewed_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = p_organization_id
        AND review.submission_id = p_submission_id
    ) THEN
    RAISE EXCEPTION 'Only submitted point submissions that have not been reviewed can be withdrawn.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.submission_id = p_submission_id
  ) THEN
    RAISE EXCEPTION 'Point submissions with awarded credit cannot be withdrawn.';
  END IF;

  UPDATE plugin_data.csf_point_submissions
  SET
    status = 'withdrawn',
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_profile_id
    AND id = p_submission_id;

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
    'point_submission.withdraw',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    jsonb_build_object(
      'status', v_submission.status,
      'submittedBy', v_submission.submitted_by,
      'claimedPoints', v_submission.claimed_points
    ),
    jsonb_build_object(
      'status', 'withdrawn',
      'submittedBy', v_submission.submitted_by,
      'claimedPoints', v_submission.claimed_points
    ),
    v_correlation_id,
    'point_submission',
    p_submission_id::text,
    'point_submission_withdrawn_by_member'
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'profileId', p_profile_id,
    'previousStatus', v_submission.status,
    'status', 'withdrawn',
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_withdraw_point_submission(uuid, uuid, uuid, uuid) IS
  'Atomically lets a CSF member withdraw their own untouched point submission and records an immutable correlated audit event.';

NOTIFY pgrst, 'reload schema';

COMMIT;
