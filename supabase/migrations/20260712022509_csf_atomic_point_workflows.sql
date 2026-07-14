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
    SELECT coalesce(policy.max_points_per_activity, 3)
    INTO v_max_points
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id;

    v_max_points := coalesce(v_max_points, 3);
    IF v_awarded_points <= 0 OR v_awarded_points > v_max_points THEN
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
      jsonb_build_object('description', v_submission.description) || v_proof,
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
      'awardedPoints', CASE WHEN p_action = 'approved' THEN v_awarded_points ELSE NULL END
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
    after_data
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
    ) || v_proof
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'previousStatus', v_previous_status,
    'status', p_action,
    'awardedPoints', CASE WHEN p_action = 'approved' THEN v_awarded_points ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_replace_point_processing_row(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_activities jsonb,
  p_meetings jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activity jsonb;
  v_meeting jsonb;
  v_meeting_id uuid;
  v_attendance_status text;
  v_activity_count integer := 0;
  v_meeting_count integer := 0;
  v_now timestamptz := now();
BEGIN
  IF jsonb_typeof(p_activities) <> 'array' OR jsonb_typeof(p_meetings) <> 'array' THEN
    RAISE EXCEPTION 'Point-processing activities and meetings must be arrays.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF profile was not found.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF term was not found.';
  END IF;

  DELETE FROM plugin_data.csf_credit_records
  WHERE organization_id = p_organization_id
    AND profile_id = p_profile_id
    AND term_id = p_term_id
    AND evidence @> '{"processor":"points_sheet"}'::jsonb;

  DELETE FROM plugin_data.csf_profile_activity_events
  WHERE organization_id = p_organization_id
    AND profile_id = p_profile_id
    AND term_id = p_term_id
    AND source_ref @> '{"processor":"points_sheet"}'::jsonb;

  DELETE FROM plugin_data.csf_meeting_attendance
  WHERE organization_id = p_organization_id
    AND profile_id = p_profile_id
    AND term_id = p_term_id
    AND source = 'manual'
    AND match_details @> '{"processor":"points_sheet"}'::jsonb;

  FOR v_activity IN SELECT value FROM jsonb_array_elements(p_activities)
  LOOP
    IF nullif(trim(v_activity->>'slot'), '') IS NULL OR nullif(trim(v_activity->>'value'), '') IS NULL THEN
      RAISE EXCEPTION 'Each point-processing activity needs a slot and value.';
    END IF;

    INSERT INTO plugin_data.csf_credit_records (
      organization_id, profile_id, term_id, source, points, point_type, status,
      verified_by, verified_at, evidence, updated_at
    ) VALUES (
      p_organization_id,
      p_profile_id,
      p_term_id,
      'manual',
      1,
      'non_drive',
      'verified',
      p_actor_user_id,
      v_now,
      jsonb_build_object(
        'processor', 'points_sheet',
        'slot', v_activity->>'slot',
        'title', v_activity->>'value'
      ),
      v_now
    );

    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id, profile_id, term_id, event_type, title, description,
      point_type, raw_points, counted_points, status, source, source_ref, updated_at
    ) VALUES (
      p_organization_id,
      p_profile_id,
      p_term_id,
      'manual_adjustment',
      v_activity->>'value',
      format('Edited in points processing as %s.', coalesce(nullif(v_activity->>'label', ''), v_activity->>'slot')),
      'non_drive',
      1,
      1,
      'verified',
      'manual',
      jsonb_build_object('processor', 'points_sheet', 'slot', v_activity->>'slot'),
      v_now
    );
    v_activity_count := v_activity_count + 1;
  END LOOP;

  FOR v_meeting IN SELECT value FROM jsonb_array_elements(p_meetings)
  LOOP
    IF nullif(trim(v_meeting->>'key'), '') IS NULL OR nullif(trim(v_meeting->>'value'), '') IS NULL THEN
      RAISE EXCEPTION 'Each point-processing meeting needs a key and value.';
    END IF;

    v_attendance_status := v_meeting->>'status';
    IF v_attendance_status NOT IN ('unknown', 'attended', 'excused', 'missed', 'not_required') THEN
      RAISE EXCEPTION 'Invalid meeting attendance status.';
    END IF;

    v_meeting_id := CASE
      WHEN nullif(v_meeting->>'meetingId', '') IS NULL THEN NULL
      ELSE (v_meeting->>'meetingId')::uuid
    END;
    IF v_meeting_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_meetings AS meeting
      WHERE meeting.organization_id = p_organization_id
        AND meeting.term_id = p_term_id
        AND meeting.id = v_meeting_id
    ) THEN
      RAISE EXCEPTION 'Point-processing meeting does not belong to this organization and term.';
    END IF;

    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id, profile_id, term_id, event_type, title, description,
      point_type, raw_points, counted_points, status, source, source_ref, updated_at
    ) VALUES (
      p_organization_id,
      p_profile_id,
      p_term_id,
      'meeting',
      coalesce(nullif(v_meeting->>'label', ''), v_meeting->>'key'),
      v_meeting->>'value',
      'meeting',
      0,
      0,
      'verified',
      'manual',
      jsonb_build_object(
        'processor', 'points_sheet',
        'slot', v_meeting->>'key',
        'termMeetingId', v_meeting_id,
        'attendanceStatus', v_attendance_status,
        'value', v_meeting->>'value'
      ),
      v_now
    );

    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id, profile_id, term_id, term_meeting_id, meeting_key,
      meeting_label, status, source, recorded_by, match_status,
      match_confidence, match_details, updated_at
    ) VALUES (
      p_organization_id,
      p_profile_id,
      p_term_id,
      v_meeting_id,
      v_meeting->>'key',
      coalesce(nullif(v_meeting->>'label', ''), v_meeting->>'key'),
      v_attendance_status,
      'manual',
      p_actor_user_id,
      'confirmed',
      1,
      jsonb_build_object('processor', 'points_sheet', 'value', v_meeting->>'value'),
      v_now
    )
    ON CONFLICT (profile_id, term_id, meeting_key)
    DO UPDATE SET
      term_meeting_id = EXCLUDED.term_meeting_id,
      meeting_label = EXCLUDED.meeting_label,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      recorded_by = EXCLUDED.recorded_by,
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_details = EXCLUDED.match_details,
      updated_at = EXCLUDED.updated_at;
    v_meeting_count := v_meeting_count + 1;
  END LOOP;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'point_processing.row_save',
    'csf_profiles',
    p_profile_id,
    p_term_id,
    jsonb_build_object('activityCount', v_activity_count, 'meetingCount', v_meeting_count)
  );

  RETURN jsonb_build_object(
    'profileId', p_profile_id,
    'termId', p_term_id,
    'activityCount', v_activity_count,
    'meetingCount', v_meeting_count
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_replace_point_processing_row(uuid, uuid, uuid, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_replace_point_processing_row(uuid, uuid, uuid, jsonb, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_review_point_submission(uuid, uuid, text, numeric, text, uuid) IS
  'Atomically applies a CSF point-submission decision, credit state, review history, and audit event.';
COMMENT ON FUNCTION plugin_data.csf_replace_point_processing_row(uuid, uuid, uuid, jsonb, jsonb, uuid) IS
  'Atomically replaces one CSF points-sheet row and its generated credits, events, attendance, and audit record.';

NOTIFY pgrst, 'reload schema';

COMMIT;
