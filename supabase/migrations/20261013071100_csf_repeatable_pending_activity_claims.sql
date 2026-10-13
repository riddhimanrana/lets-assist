-- Permit separate pending donations for repeatable quantity/per-item activities without allowing excess reserved claims.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_submission_authority_base_20260810(
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
  v_has_proof boolean := p_file_object_path IS NOT NULL;
  v_status text := CASE WHEN p_file_object_path IS NULL THEN 'submitted' ELSE 'draft' END;
  v_now timestamptz := now();
  v_rules jsonb;
  v_person_cap numeric;
  v_reserved numeric;
BEGIN
  IF p_submission_id IS NULL OR p_profile_id IS NULL OR p_term_id IS NULL
    OR p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission identity is incomplete.';
  END IF;
  IF p_claimed_points IS NULL OR p_claimed_points <= 0 THEN
    RAISE EXCEPTION 'Claimed points must be greater than zero.';
  END IF;
  IF p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Point-submission actor is not an organization member.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.id = p_profile_id
      AND profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF profile was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id
      AND term.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'CSF term was not found.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.id = p_opportunity_id
      AND opportunity.organization_id = p_organization_id
      AND opportunity.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'CSF activity belongs to a different organization or term.';
  END IF;
  IF p_partner_club_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_partner_club_terms AS club_term
    WHERE club_term.id = p_partner_club_term_id
      AND club_term.organization_id = p_organization_id
      AND club_term.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'Partner-club policy belongs to a different organization or term.';
  END IF;

  IF v_has_proof THEN
    IF p_file_id IS NULL OR p_upload_token IS NULL
      OR nullif(btrim(coalesce(p_file_bucket, '')), '') IS NULL
      OR nullif(btrim(coalesce(p_file_original_filename, '')), '') IS NULL
      OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 THEN
      RAISE EXCEPTION 'Pending proof metadata is incomplete.';
    END IF;
    IF p_file_bucket <> 'plugins' THEN
      RAISE EXCEPTION 'CSF proof must use the private CSF bucket.';
    END IF;
  ELSIF p_file_id IS NOT NULL OR p_upload_token IS NOT NULL OR p_file_bucket IS NOT NULL
    OR p_file_original_filename IS NOT NULL OR p_file_mime_type IS NOT NULL
    OR p_file_size_bytes IS NOT NULL THEN
    RAISE EXCEPTION 'Proof metadata was provided without an object path.';
  END IF;

  -- The unique index sees the row on INSERT, before the request wrapper's
  -- later UPDATE. Give it the current locked activity rules at that point.
  IF p_opportunity_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_term_id::text, 0
    ));
    SELECT plugin_data.csf_effective_earning_rules(
      activity.earning_rules, activity.point_value, activity.point_type
    )
    INTO v_rules
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_opportunity_id
      AND activity.term_id = p_term_id
    FOR UPDATE;

    IF v_rules ->> 'mode' IN ('quantity', 'per_item')
      AND (v_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
      -- The same lock order serializes separate requests from one member and
      -- officer approvals against the reserved-plus-verified point total.
      SELECT least(
        coalesce(activity.point_cap, nullif(activity.point_value, 0), policy.max_points_per_activity),
        policy.max_points_per_activity
      )
      INTO v_person_cap
      FROM plugin_data.csf_opportunities AS activity
      JOIN plugin_data.csf_term_policies AS policy
        ON policy.organization_id = activity.organization_id
       AND policy.term_id = activity.term_id
       AND policy.published_at IS NOT NULL
      WHERE activity.organization_id = p_organization_id
        AND activity.id = p_opportunity_id
        AND activity.term_id = p_term_id;
      IF v_person_cap IS NULL THEN
        RAISE EXCEPTION 'A published semester policy is required for this point action.';
      END IF;

      SELECT coalesce(pg_catalog.sum(points), 0)
      INTO v_reserved
      FROM (
        SELECT credit.points
        FROM plugin_data.csf_credit_records AS credit
        WHERE credit.organization_id = p_organization_id
          AND credit.profile_id = p_profile_id
          AND credit.opportunity_id = p_opportunity_id
          AND credit.status = 'verified'
        UNION ALL
        SELECT submission.claimed_points
        FROM plugin_data.csf_point_submissions AS submission
        WHERE submission.organization_id = p_organization_id
          AND submission.profile_id = p_profile_id
          AND submission.term_id = p_term_id
          AND submission.opportunity_id = p_opportunity_id
          AND submission.status IN ('draft', 'submitted', 'needs_action')
      ) AS active_points;
      IF v_reserved + p_claimed_points > v_person_cap THEN
        RAISE EXCEPTION 'This activity allows at most % points per person; % already submitted or verified.',
          v_person_cap, v_reserved;
      END IF;
    END IF;
  END IF;

  INSERT INTO plugin_data.csf_point_submissions (
    id, organization_id, profile_id, term_id, opportunity_id, partner_club_term_id,
    source, description, claimed_points, point_type, activity_date, status,
    submitted_by, submitted_at, created_at, updated_at, earning_rules_snapshot
  ) VALUES (
    p_submission_id, p_organization_id, p_profile_id, p_term_id, p_opportunity_id,
    p_partner_club_term_id, p_source, p_description, p_claimed_points, p_point_type,
    p_activity_date, v_status, p_actor_user_id, v_now, v_now, v_now, v_rules
  );

  IF v_has_proof THEN
    INSERT INTO plugin_data.csf_submission_files (
      id, organization_id, submission_id, profile_id, term_id, bucket, object_path,
      original_filename, mime_type, size_bytes, uploaded_by, upload_status,
      upload_token, upload_correlation_id, created_at, updated_at
    ) VALUES (
      p_file_id, p_organization_id, p_submission_id, p_profile_id, p_term_id,
      p_file_bucket, p_file_object_path, p_file_original_filename, p_file_mime_type,
      p_file_size_bytes, p_actor_user_id, 'pending', p_upload_token, p_correlation_id,
      v_now, v_now
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, p_profile_id,
    CASE WHEN v_has_proof THEN 'point_submission.proof_pending' ELSE 'point_submission.create' END,
    'csf_point_submissions', p_submission_id, p_term_id, NULL,
    jsonb_build_object(
      'status', v_status,
      'claimedPoints', p_claimed_points,
      'pointType', p_point_type,
      'hasProof', v_has_proof,
      'proofStatus', CASE WHEN v_has_proof THEN 'pending' ELSE NULL END,
      'opportunityId', p_opportunity_id,
      'partnerClubTermId', p_partner_club_term_id
    ),
    p_correlation_id, 'point_submission', p_submission_id::text,
    CASE WHEN v_has_proof THEN 'point_proof_upload_started' ELSE 'point_submission_created' END
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', v_status,
    'correlationId', p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_authority_base_20260810(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission_authority_base_20260810(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) TO postgres;

-- Fixed, legacy and unknown modes retain the one-claim guard. Shift and
-- assessment modes still allow only one unfinished claim; repeatable quantity
-- and per-item donations may have separate unfinished claims within the cap.
DROP INDEX plugin_data.csf_point_submissions_one_active_activity_claim_idx;
CREATE UNIQUE INDEX csf_point_submissions_one_active_activity_claim_idx
  ON plugin_data.csf_point_submissions (organization_id, profile_id, term_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL
    AND status NOT IN ('rejected', 'duplicate', 'withdrawn')
    AND (
      earning_rules_snapshot -> 'legacy' = 'true'::jsonb
      OR coalesce(earning_rules_snapshot ->> 'mode', '')
        NOT IN ('quantity', 'per_item', 'shifts', 'assessment')
      OR (status <> 'approved'
        AND coalesce(earning_rules_snapshot ->> 'mode', '') IN ('shifts', 'assessment'))
    );

COMMENT ON INDEX plugin_data.csf_point_submissions_one_active_activity_claim_idx IS
  'Fixed, legacy, and unknown modes allow one active claim per member/activity. Shifts and assessment allow one unfinished claim. Quantity and per_item use locked reserved-plus-verified point caps instead.';

COMMIT;
