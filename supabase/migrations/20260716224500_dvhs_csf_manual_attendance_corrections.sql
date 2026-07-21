-- Keep manual attendance corrections explicit, reasoned, tenant-scoped, and
-- atomic with their immutable audit event.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_correct_meeting_attendance(
  p_organization_id uuid,
  p_meeting_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_status text,
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
  v_meeting plugin_data.csf_term_meetings%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_session plugin_data.csf_meeting_sessions%ROWTYPE;
  v_existing plugin_data.csf_meeting_attendance%ROWTYPE;
  v_attendance_id uuid;
  v_existing_found boolean := false;
  v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
BEGIN
  IF p_operation NOT IN ('set', 'remove') THEN
    RAISE EXCEPTION 'Attendance correction operation must be set or remove.';
  END IF;
  IF p_operation = 'set' AND p_status NOT IN ('unknown', 'attended', 'excused', 'missed', 'not_required') THEN
    RAISE EXCEPTION 'Choose a valid attendance status.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A manual attendance correction reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A manual attendance correction actor is required.';
  END IF;

  SELECT meeting.*
  INTO v_meeting
  FROM plugin_data.csf_term_meetings AS meeting
  WHERE meeting.organization_id = p_organization_id
    AND meeting.id = p_meeting_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found.';
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

  SELECT attendance.*
  INTO v_existing
  FROM plugin_data.csf_meeting_attendance AS attendance
  WHERE attendance.organization_id = p_organization_id
    AND attendance.profile_id = p_profile_id
    AND attendance.term_id = v_meeting.term_id
    AND attendance.meeting_key = v_meeting.meeting_key
  FOR UPDATE;
  v_existing_found := FOUND;

  IF v_existing_found THEN
    v_before := jsonb_build_object(
      'attendanceId', v_existing.id,
      'status', v_existing.status,
      'source', v_existing.source,
      'sourceRowId', v_existing.source_row_id,
      'meetingId', v_existing.term_meeting_id
    );
  END IF;

  IF p_operation = 'remove' THEN
    IF NOT v_existing_found THEN
      RAISE EXCEPTION 'No attendance record exists for this member and meeting.';
    END IF;
    IF v_existing.source <> 'manual' THEN
      RAISE EXCEPTION 'Only a manual attendance correction can be removed.';
    END IF;

    v_attendance_id := v_existing.id;
    DELETE FROM plugin_data.csf_meeting_attendance
    WHERE organization_id = p_organization_id
      AND id = v_existing.id;
    v_after := NULL;
  ELSE
    SELECT session.*
    INTO v_session
    FROM plugin_data.csf_meeting_sessions AS session
    WHERE session.organization_id = p_organization_id
      AND session.legacy_term_meeting_id = v_meeting.id
    LIMIT 1;

    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id,
      profile_id,
      term_id,
      term_meeting_id,
      meeting_id,
      meeting_session_id,
      meeting_key,
      meeting_label,
      status,
      source,
      source_row_id,
      recorded_by,
      match_status,
      match_confidence,
      match_details,
      updated_at
    ) VALUES (
      p_organization_id,
      p_profile_id,
      v_meeting.term_id,
      v_meeting.id,
      v_session.meeting_id,
      v_session.id,
      v_meeting.meeting_key,
      v_meeting.label,
      p_status,
      'manual',
      CASE WHEN v_existing_found THEN v_existing.source_row_id ELSE NULL END,
      p_actor_user_id,
      'confirmed',
      1,
      jsonb_build_object(
        'processor', 'manual_attendance_correction',
        'reason', p_reason,
        'correlationId', v_correlation_id,
        'previousSource', CASE WHEN v_existing_found THEN v_existing.source ELSE NULL END,
        'previousSourceRowId', CASE WHEN v_existing_found THEN v_existing.source_row_id ELSE NULL END
      ),
      v_now
    )
    ON CONFLICT (profile_id, term_id, meeting_key)
    DO UPDATE SET
      term_meeting_id = EXCLUDED.term_meeting_id,
      meeting_id = EXCLUDED.meeting_id,
      meeting_session_id = EXCLUDED.meeting_session_id,
      meeting_label = EXCLUDED.meeting_label,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      recorded_by = EXCLUDED.recorded_by,
      match_status = EXCLUDED.match_status,
      match_confidence = EXCLUDED.match_confidence,
      match_details = EXCLUDED.match_details,
      updated_at = EXCLUDED.updated_at
    RETURNING id INTO v_attendance_id;

    v_after := jsonb_build_object(
      'attendanceId', v_attendance_id,
      'status', p_status,
      'source', 'manual',
      'meetingId', v_meeting.id,
      'profileId', p_profile_id,
      'reason', p_reason
    );
  END IF;

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
    CASE WHEN p_operation = 'remove'
      THEN 'meeting.attendance_manual_removed'
      ELSE 'meeting.attendance_manual_corrected'
    END,
    'csf_meeting_attendance',
    v_attendance_id,
    v_meeting.term_id,
    v_before,
    v_after,
    v_correlation_id,
    'manual_correction',
    v_meeting.id::text,
    CASE WHEN p_operation = 'remove'
      THEN 'manual_attendance_removed'
      ELSE 'manual_attendance_corrected'
    END
  );

  RETURN jsonb_build_object(
    'attendanceId', v_attendance_id,
    'meetingId', v_meeting.id,
    'profileId', v_profile.id,
    'operation', p_operation,
    'status', CASE WHEN p_operation = 'set' THEN p_status ELSE NULL END,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) IS 'Server-only atomic manual meeting-attendance correction or removal with immutable audit history.';

COMMIT;
