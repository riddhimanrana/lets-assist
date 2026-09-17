-- Store an explicit response time zone and enforce an inclusive attendance window.
BEGIN;

CREATE FUNCTION plugin_data.csf_validate_attendance_window(p_window jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_open timestamptz; v_close timestamptz;
BEGIN
  IF jsonb_typeof(p_window) IS DISTINCT FROM 'object'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_window->>'timeZone') THEN
    RAISE EXCEPTION 'Choose a valid attendance source time zone.';
  END IF;
  IF (p_window->>'opensAt' IS NOT NULL AND p_window->>'opensAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$')
    OR (p_window->>'closesAt' IS NOT NULL AND p_window->>'closesAt' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') THEN
    RAISE EXCEPTION 'Attendance window timestamps require explicit offsets.';
  END IF;
  v_open := (p_window->>'opensAt')::timestamptz;
  v_close := (p_window->>'closesAt')::timestamptz;
  IF v_open > v_close THEN RAISE EXCEPTION 'Attendance must close after it opens.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_validate_attendance_window(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_validate_attendance_window(jsonb) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_label text,
  p_meeting_dates date[],
  p_starts_at timestamptz,
  p_location text,
  p_attendance_source_url text,
  p_required boolean,
  p_sort_order integer,
  p_status text,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_attendance_window jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_legacy plugin_data.csf_term_meetings%ROWTYPE;
  v_logical plugin_data.csf_meetings%ROWTYPE;
  v_session plugin_data.csf_meeting_sessions%ROWTYPE;
  v_existing_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_request jsonb;
  v_expected_action text := CASE
    WHEN p_meeting_id IS NULL THEN 'term_meeting.create'
    ELSE 'term_meeting.edit'
  END;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_attendance_source_url text := nullif(btrim(coalesce(p_attendance_source_url, '')), '');
  v_required boolean := coalesce(p_required, false);
  v_sort_order integer := coalesce(p_sort_order, 0);
  v_status text := coalesce(p_status, 'active');
  v_session_status text;
  v_extra_status text;
  v_dates date[];
  v_primary_date date;
  v_extra_dates date[];
  v_extra_date date;
  v_extra_session plugin_data.csf_meeting_sessions%ROWTYPE;
  v_session_ids uuid[];
  v_now timestamptz := now();
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(p_organization_id, p_actor_user_id, 'manage_meetings');
  v_attendance_source_url := plugin_data.csf_assert_meeting_source_permissions_under_lock(p_organization_id, p_term_id, p_meeting_id, p_attendance_source_url, p_actor_user_id);
  IF p_attendance_window IS NOT NULL THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(p_organization_id, p_actor_user_id, 'import_meetings');
    PERFORM plugin_data.csf_validate_attendance_window(p_attendance_window);
  END IF;
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_meetings'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF meetings.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A meeting request identifier is required.';
  END IF;
  IF p_term_id IS NULL THEN
    RAISE EXCEPTION 'A CSF semester is required.';
  END IF;
  IF v_label IS NULL OR length(v_label) > 200 THEN
    RAISE EXCEPTION 'Enter a meeting name between 1 and 200 characters.';
  END IF;
  IF v_sort_order < 0 OR v_sort_order > 1000 THEN
    RAISE EXCEPTION 'Meeting display order must be between 0 and 1000.';
  END IF;
  IF v_status NOT IN ('active', 'inactive', 'archived') THEN
    RAISE EXCEPTION 'Choose a valid meeting status.';
  END IF;

  SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}'::date[])
  INTO v_dates
  FROM unnest(coalesce(p_meeting_dates, '{}'::date[])) AS d
  WHERE d IS NOT NULL;
  IF cardinality(v_dates) > 12 THEN
    RAISE EXCEPTION 'A meeting can have at most 12 dates.';
  END IF;
  v_primary_date := CASE WHEN cardinality(v_dates) > 0 THEN v_dates[1] ELSE NULL END;
  v_extra_dates := CASE
    WHEN cardinality(v_dates) > 1 THEN v_dates[2:cardinality(v_dates)]
    ELSE '{}'::date[]
  END;

  v_request := jsonb_build_object(
    'attendanceWindow', p_attendance_window,
    'meetingId', p_meeting_id,
    'termId', p_term_id,
    'label', v_label,
    'meetingDates', to_jsonb(v_dates),
    'startsAt', p_starts_at,
    'location', v_location,
    'attendanceSourceUrl', v_attendance_source_url,
    'required', v_required,
    'sortOrder', v_sort_order,
    'status', v_status
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_term_meeting_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_existing_audit
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_existing_audit.action IS DISTINCT FROM v_expected_action
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_term_meetings'
      OR v_existing_audit.term_id IS DISTINCT FROM p_term_id
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request
      OR (
        p_meeting_id IS NOT NULL
        AND v_existing_audit.target_id IS DISTINCT FROM p_meeting_id
      ) THEN
      RAISE EXCEPTION 'That meeting request identifier is already bound to a different change.';
    END IF;

    RETURN jsonb_build_object(
      'meetingId', v_existing_audit.target_id,
      'logicalMeetingId', v_existing_audit.after_data ->> 'logicalMeetingId',
      'sessionId', v_existing_audit.after_data ->> 'sessionId',
      'sessionIds', coalesce(v_existing_audit.after_data -> 'sessionIds', '[]'::jsonb),
      'operation', CASE WHEN p_meeting_id IS NULL THEN 'created' ELSE 'updated' END,
      'correlationId', p_request_id,
      'idempotent', true
    );
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF semester was not found in this organization.';
  END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived CSF semesters cannot change meeting evidence.';
  END IF;

  IF p_meeting_id IS NULL THEN
    INSERT INTO plugin_data.csf_term_meetings (
      organization_id,
      term_id,
      meeting_key,
      label,
      meeting_date,
      starts_at,
      location,
      attendance_source_url,
      required,
      sort_order,
      status,
      created_by,
      updated_at,
      settings
    ) VALUES (
      p_organization_id,
      p_term_id,
      plugin_data.csf_meeting_key_from_label(v_label, v_sort_order + 1),
      v_label,
      v_primary_date,
      p_starts_at,
      v_location,
      v_attendance_source_url,
      v_required,
      v_sort_order,
      v_status,
      p_actor_user_id,
      v_now,
      CASE WHEN p_attendance_window IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('attendanceWindow', p_attendance_window) END
    )
    RETURNING * INTO v_legacy;

    INSERT INTO plugin_data.csf_meetings (
      organization_id,
      term_id,
      meeting_key,
      label,
      required,
      sort_order,
      status,
      created_by,
      updated_at
    ) VALUES (
      p_organization_id,
      p_term_id,
      v_legacy.meeting_key,
      v_label,
      v_required,
      v_sort_order,
      v_status,
      p_actor_user_id,
      v_now
    )
    RETURNING * INTO v_logical;

    v_session_status := CASE v_status
      WHEN 'active' THEN 'scheduled'
      WHEN 'inactive' THEN 'cancelled'
      ELSE 'archived'
    END;

    INSERT INTO plugin_data.csf_meeting_sessions (
      organization_id,
      meeting_id,
      legacy_term_meeting_id,
      session_date,
      starts_at,
      location,
      attendance_source_url,
      status,
      settings,
      created_by,
      updated_at
    ) VALUES (
      p_organization_id,
      v_logical.id,
      v_legacy.id,
      v_primary_date,
      p_starts_at,
      v_location,
      v_attendance_source_url,
      v_session_status,
      v_legacy.settings,
      p_actor_user_id,
      v_now
    )
    RETURNING * INTO v_session;
  ELSE
    SELECT meeting.*
    INTO v_legacy
    FROM plugin_data.csf_term_meetings AS meeting
    WHERE meeting.organization_id = p_organization_id
      AND meeting.term_id = p_term_id
      AND meeting.id = p_meeting_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting was not found in this organization and semester.';
    END IF;

    SELECT session.*
    INTO v_session
    FROM plugin_data.csf_meeting_sessions AS session
    WHERE session.organization_id = p_organization_id
      AND session.legacy_term_meeting_id = v_legacy.id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting session projection was not found for this meeting.';
    END IF;

    SELECT meeting.*
    INTO v_logical
    FROM plugin_data.csf_meetings AS meeting
    WHERE meeting.organization_id = p_organization_id
      AND meeting.term_id = p_term_id
      AND meeting.id = v_session.meeting_id
      AND meeting.meeting_key = v_legacy.meeting_key
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Logical meeting projection was not found for this meeting and semester.';
    END IF;

    v_before := jsonb_build_object(
      'meetingId', v_legacy.id,
      'logicalMeetingId', v_logical.id,
      'sessionId', v_session.id,
      'label', v_legacy.label,
      'meetingDate', v_legacy.meeting_date,
      'startsAt', v_legacy.starts_at,
      'location', v_legacy.location,
      'attendanceSourceUrl', v_legacy.attendance_source_url,
      'required', v_legacy.required,
      'sortOrder', v_legacy.sort_order,
      'legacyStatus', v_legacy.status,
      'logicalStatus', v_logical.status,
      'sessionStatus', v_session.status
    );

    v_session_status := CASE v_status
      WHEN 'inactive' THEN 'cancelled'
      WHEN 'archived' THEN 'archived'
      ELSE CASE
        WHEN v_session.status IN ('open', 'closed') THEN v_session.status
        ELSE 'scheduled'
      END
    END;

    UPDATE plugin_data.csf_term_meetings
    SET
      label = v_label,
      meeting_date = v_primary_date,
      starts_at = p_starts_at,
      location = v_location,
      attendance_source_url = v_attendance_source_url,
      required = v_required,
      sort_order = v_sort_order,
      status = v_status,
      updated_at = v_now,
      settings = CASE WHEN p_attendance_window IS NULL THEN settings ELSE jsonb_set(coalesce(settings, '{}'::jsonb), '{attendanceWindow}', p_attendance_window) END
    WHERE organization_id = p_organization_id
      AND term_id = p_term_id
      AND id = p_meeting_id
    RETURNING * INTO v_legacy;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting disappeared before the change could be saved.';
    END IF;

    UPDATE plugin_data.csf_meetings
    SET
      label = v_label,
      required = v_required,
      sort_order = v_sort_order,
      status = v_status,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND term_id = p_term_id
      AND id = v_logical.id
    RETURNING * INTO v_logical;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Logical meeting projection disappeared before the change could be saved.';
    END IF;

    UPDATE plugin_data.csf_meeting_sessions
    SET
      session_date = v_primary_date,
      starts_at = p_starts_at,
      location = v_location,
      attendance_source_url = v_attendance_source_url,
      status = v_session_status,
      settings = v_legacy.settings,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND meeting_id = v_logical.id
      AND legacy_term_meeting_id = v_legacy.id
      AND id = v_session.id
    RETURNING * INTO v_session;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Meeting session projection disappeared before the change could be saved.';
    END IF;
  END IF;

  -- Reconcile the additional (non-primary) dated sessions. Each extra date
  -- shares the meeting's location, Sheet, and time of day; its starts_at is
  -- composed per-date in Pacific time so DST transitions stay correct.
  v_extra_status := CASE v_status
    WHEN 'active' THEN 'scheduled'
    WHEN 'inactive' THEN 'cancelled'
    ELSE 'archived'
  END;
  v_session_ids := ARRAY[v_session.id];

  FOREACH v_extra_date IN ARRAY v_extra_dates LOOP
    SELECT session.*
    INTO v_extra_session
    FROM plugin_data.csf_meeting_sessions AS session
    WHERE session.organization_id = p_organization_id
      AND session.meeting_id = v_logical.id
      AND session.legacy_term_meeting_id IS NULL
      AND session.session_date = v_extra_date
    ORDER BY session.created_at, session.id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE plugin_data.csf_meeting_sessions
      SET
        starts_at = CASE
          WHEN p_starts_at IS NULL THEN NULL
          ELSE (
            v_extra_date
              + (p_starts_at AT TIME ZONE 'America/Los_Angeles')::time
          ) AT TIME ZONE 'America/Los_Angeles'
        END,
        location = v_location,
        attendance_source_url = v_attendance_source_url,
        status = CASE
          WHEN v_status = 'active' AND v_extra_session.status IN ('open', 'closed')
            THEN v_extra_session.status
          ELSE v_extra_status
        END,
        settings = v_legacy.settings,
        updated_at = v_now
      WHERE id = v_extra_session.id
      RETURNING * INTO v_extra_session;
    ELSE
      INSERT INTO plugin_data.csf_meeting_sessions (
        organization_id,
        meeting_id,
        legacy_term_meeting_id,
        session_date,
        starts_at,
        location,
        attendance_source_url,
        status,
        settings,
        created_by,
        updated_at
      ) VALUES (
        p_organization_id,
        v_logical.id,
        NULL,
        v_extra_date,
        CASE
          WHEN p_starts_at IS NULL THEN NULL
          ELSE (
            v_extra_date
              + (p_starts_at AT TIME ZONE 'America/Los_Angeles')::time
          ) AT TIME ZONE 'America/Los_Angeles'
        END,
        v_location,
        v_attendance_source_url,
        v_extra_status,
        v_legacy.settings,
        p_actor_user_id,
        v_now
      )
      RETURNING * INTO v_extra_session;
    END IF;

    v_session_ids := v_session_ids || v_extra_session.id;
  END LOOP;

  -- Dates removed from the meeting archive their sessions; attendance rows
  -- reference sessions, so they are never deleted.
  UPDATE plugin_data.csf_meeting_sessions
  SET status = 'archived', updated_at = v_now
  WHERE organization_id = p_organization_id
    AND meeting_id = v_logical.id
    AND legacy_term_meeting_id IS NULL
    AND status <> 'archived'
    AND id <> ALL (v_session_ids);

  v_after := jsonb_build_object(
    'request', v_request,
    'meetingId', v_legacy.id,
    'logicalMeetingId', v_logical.id,
    'sessionId', v_session.id,
    'sessionIds', to_jsonb(v_session_ids),
    'meetingKey', v_legacy.meeting_key,
    'legacyStatus', v_legacy.status,
    'logicalStatus', v_logical.status,
    'sessionStatus', v_session.status
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
    v_expected_action,
    'csf_term_meetings',
    v_legacy.id,
    p_term_id,
    v_before,
    v_after,
    p_request_id,
    'staff_action',
    v_legacy.id::text,
    CASE
      WHEN p_meeting_id IS NULL THEN 'term_meeting_created'
      ELSE 'term_meeting_updated'
    END
  );

  RETURN jsonb_build_object(
    'meetingId', v_legacy.id,
    'logicalMeetingId', v_logical.id,
    'sessionId', v_session.id,
    'sessionIds', to_jsonb(v_session_ids),
    'operation', CASE WHEN p_meeting_id IS NULL THEN 'created' ELSE 'updated' END,
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(uuid,uuid,uuid,text,date[],timestamptz,text,text,boolean,integer,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting_with_attendance_window(uuid,uuid,uuid,text,date[],timestamptz,text,text,boolean,integer,text,uuid,uuid,jsonb) TO postgres,service_role;

CREATE FUNCTION plugin_data.csf_guard_attendance_response_window()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_window jsonb;
BEGIN
  IF NEW.source <> 'sheet' OR NEW.status <> 'attended' THEN RETURN NEW; END IF;
  SELECT settings->'attendanceWindow' INTO v_window
  FROM plugin_data.csf_term_meetings
  WHERE organization_id=NEW.organization_id AND id=NEW.term_meeting_id
  FOR SHARE;
  IF v_window IS NULL THEN RETURN NEW; END IF;
  PERFORM plugin_data.csf_validate_attendance_window(v_window);
  IF v_window->>'opensAt' IS NULL AND v_window->>'closesAt' IS NULL THEN RETURN NEW; END IF;
  IF NEW.source_submitted_at IS NULL
    OR NEW.source_submitted_at < (v_window->>'opensAt')::timestamptz
    OR NEW.source_submitted_at > (v_window->>'closesAt')::timestamptz THEN
    RAISE EXCEPTION 'This response falls outside the meeting attendance window.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_attendance_response_window() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_attendance_response_window() TO postgres;
CREATE TRIGGER csf_attendance_response_window_guard BEFORE INSERT OR UPDATE OF source_submitted_at,status,term_meeting_id,source
ON plugin_data.csf_meeting_attendance FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_attendance_response_window();
-- Repair a timestamp that was interpreted as UTC instead of the verified source zone.
CREATE FUNCTION plugin_data.csf_correct_attendance_source_timestamp(
  p_organization_id uuid, p_attendance_id uuid, p_source_row_id uuid,
  p_source_id uuid, p_sheet_row integer, p_expected_submitted_at timestamptz,
  p_corrected_submitted_at timestamptz, p_source_time_zone text,
  p_reason text, p_request_id uuid, p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attendance plugin_data.csf_meeting_attendance%ROWTYPE;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request jsonb;
  v_result jsonb;
  v_prior_suppression text;
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(p_organization_id,p_actor_user_id,'reconcile_meeting_attendance');
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(p_organization_id,p_actor_user_id,'import_meetings');
  IF p_request_id IS NULL OR length(btrim(coalesce(p_reason,''))) < 4 THEN
    RAISE EXCEPTION 'A correction request and source verification reason are required.';
  END IF;
  IF p_expected_submitted_at IS NULL OR p_corrected_submitted_at IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_source_time_zone) THEN
    RAISE EXCEPTION 'Both timestamps and a valid source time zone are required.';
  END IF;
  IF (p_expected_submitted_at AT TIME ZONE 'UTC' AT TIME ZONE p_source_time_zone) IS DISTINCT FROM p_corrected_submitted_at THEN
    RAISE EXCEPTION 'The correction must reinterpret the original source wall clock in its verified time zone.';
  END IF;
  v_request := jsonb_build_object('attendanceId',p_attendance_id,'sourceRowId',p_source_row_id,'sourceId',p_source_id,'sheetRow',p_sheet_row,'expectedSubmittedAt',p_expected_submitted_at,'correctedSubmittedAt',p_corrected_submitted_at,'timeZone',p_source_time_zone,'reason',p_reason);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('csf_attendance_timestamp:'||p_organization_id::text||':'||p_request_id::text,0));
  SELECT * INTO v_audit FROM plugin_data.csf_admin_audit_events
  WHERE organization_id=p_organization_id AND correlation_id=p_request_id ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN
    IF v_audit.action IS DISTINCT FROM 'meeting.attendance_timestamp_corrected'
      OR v_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_audit.after_data->'request' IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'This timestamp correction request was already used with different input.';
    END IF;
    RETURN v_audit.after_data->'result';
  END IF;
  SELECT * INTO v_attendance FROM plugin_data.csf_meeting_attendance
  WHERE organization_id=p_organization_id AND id=p_attendance_id FOR UPDATE;
  IF NOT FOUND OR v_attendance.source IS DISTINCT FROM 'sheet'
    OR v_attendance.source_row_id IS DISTINCT FROM p_source_row_id
    OR v_attendance.source_submitted_at IS DISTINCT FROM p_expected_submitted_at THEN
    RAISE EXCEPTION 'Attendance source evidence changed. Review the current record before correcting it.';
  END IF;
  PERFORM 1 FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_source_row_id
      AND source_id=p_source_id AND row_number=p_sheet_row
      AND matched_profile_id=v_attendance.profile_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The supplied source row does not prove this attendance record.';
  END IF;
  v_prior_suppression := current_setting('app.csf_suppress_notices',true);
  PERFORM pg_catalog.set_config('app.csf_suppress_notices','on',true);
  UPDATE plugin_data.csf_meeting_attendance SET source_submitted_at=p_corrected_submitted_at, updated_at=now()
  WHERE organization_id=p_organization_id AND id=p_attendance_id;
  PERFORM pg_catalog.set_config('app.csf_suppress_notices',coalesce(v_prior_suppression,''),true);
  v_result := jsonb_build_object('attendanceId',p_attendance_id,'sourceSubmittedAt',p_corrected_submitted_at,'correlationId',p_request_id);
  INSERT INTO plugin_data.csf_admin_audit_events(organization_id,actor_user_id,action,target_type,target_id,term_id,before_data,after_data,correlation_id,source_type,source_id,reason_code)
  VALUES(p_organization_id,p_actor_user_id,'meeting.attendance_timestamp_corrected','csf_meeting_attendance',p_attendance_id,v_attendance.term_id,
    jsonb_build_object('sourceSubmittedAt',v_attendance.source_submitted_at,'sourceRowId',v_attendance.source_row_id,'status',v_attendance.status,'source',v_attendance.source),
    jsonb_build_object('request',v_request,'result',v_result,'status',v_attendance.status,'source',v_attendance.source,'noticesSuppressed',true),p_request_id,'source_reconciliation',p_source_row_id::text,'source_timezone_corrected');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_correct_attendance_source_timestamp(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_attendance_source_timestamp(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text,uuid,uuid) TO postgres,service_role;

COMMIT;
