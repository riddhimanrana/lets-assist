-- A logical CSF meeting can happen on several dates in the same week (for
-- example Wednesday and Thursday under one "September meeting" name, one
-- attendance Sheet, one attendance record per member). The legacy
-- csf_term_meetings row keeps the earliest date so existing readers and
-- sort order stay valid; additional dates live as csf_meeting_sessions rows
-- without a legacy back-link. Archiving a meeting now archives every one of
-- its sessions, not just the legacy-linked one.

BEGIN;

-- One live session per meeting per date. Archived/cancelled sessions are
-- excluded so a removed date can be re-added later without a collision.
CREATE UNIQUE INDEX IF NOT EXISTS csf_meeting_sessions_meeting_date_unique_idx
  ON plugin_data.csf_meeting_sessions (organization_id, meeting_id, session_date)
  WHERE status NOT IN ('archived', 'cancelled') AND session_date IS NOT NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_term_meeting(
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
  p_actor_user_id uuid
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
      updated_at
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
      v_now
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
      updated_at = v_now
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

-- Backward-compatible single-date signature: delegates to the array form so
-- the migration can deploy ahead of the app. Drop in a later cleanup
-- migration once no caller passes a single date.
CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_term_meeting(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_label text,
  p_meeting_date date,
  p_starts_at timestamptz,
  p_location text,
  p_attendance_source_url text,
  p_required boolean,
  p_sort_order integer,
  p_status text,
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT plugin_data.csf_upsert_term_meeting(
    p_organization_id,
    p_term_id,
    p_meeting_id,
    p_label,
    CASE WHEN p_meeting_date IS NULL THEN '{}'::date[] ELSE ARRAY[p_meeting_date] END,
    p_starts_at,
    p_location,
    p_attendance_source_url,
    p_required,
    p_sort_order,
    p_status,
    p_request_id,
    p_actor_user_id
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_archive_term_meeting(
  p_organization_id uuid,
  p_term_id uuid,
  p_meeting_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid
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
  v_archived_session_ids uuid[];
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_meetings'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF meetings.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A meeting archive request identifier is required.';
  END IF;
  IF p_term_id IS NULL OR p_meeting_id IS NULL THEN
    RAISE EXCEPTION 'A CSF semester and meeting are required.';
  END IF;

  v_request := jsonb_build_object(
    'meetingId', p_meeting_id,
    'termId', p_term_id,
    'status', 'archived'
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
    IF v_existing_audit.action IS DISTINCT FROM 'term_meeting.archive'
      OR v_existing_audit.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_audit.target_type IS DISTINCT FROM 'csf_term_meetings'
      OR v_existing_audit.target_id IS DISTINCT FROM p_meeting_id
      OR v_existing_audit.term_id IS DISTINCT FROM p_term_id
      OR (v_existing_audit.after_data -> 'request') IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'That meeting archive request identifier is already bound to a different change.';
    END IF;

    RETURN jsonb_build_object(
      'meetingId', v_existing_audit.target_id,
      'logicalMeetingId', v_existing_audit.after_data ->> 'logicalMeetingId',
      'sessionId', v_existing_audit.after_data ->> 'sessionId',
      'operation', 'archived',
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

  IF v_legacy.status = 'archived'
    AND v_logical.status = 'archived'
    AND v_session.status = 'archived'
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_meeting_sessions AS session
      WHERE session.organization_id = p_organization_id
        AND session.meeting_id = v_logical.id
        AND session.status <> 'archived'
    ) THEN
    RAISE EXCEPTION 'Meeting is already archived.';
  END IF;

  v_before := jsonb_build_object(
    'meetingId', v_legacy.id,
    'logicalMeetingId', v_logical.id,
    'sessionId', v_session.id,
    'legacyStatus', v_legacy.status,
    'logicalStatus', v_logical.status,
    'sessionStatus', v_session.status
  );

  UPDATE plugin_data.csf_term_meetings
  SET status = 'archived', updated_at = v_now
  WHERE organization_id = p_organization_id
    AND term_id = p_term_id
    AND id = p_meeting_id
  RETURNING * INTO v_legacy;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting disappeared before it could be archived.';
  END IF;

  UPDATE plugin_data.csf_meetings
  SET status = 'archived', updated_at = v_now
  WHERE organization_id = p_organization_id
    AND term_id = p_term_id
    AND id = v_logical.id
  RETURNING * INTO v_logical;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logical meeting projection disappeared before it could be archived.';
  END IF;

  -- Archive every session of the logical meeting, not just the
  -- legacy-linked one — a multi-date meeting has additional dated sessions.
  WITH archived AS (
    UPDATE plugin_data.csf_meeting_sessions
    SET status = 'archived', updated_at = v_now
    WHERE organization_id = p_organization_id
      AND meeting_id = v_logical.id
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_archived_session_ids FROM archived;

  SELECT session.*
  INTO v_session
  FROM plugin_data.csf_meeting_sessions AS session
  WHERE session.organization_id = p_organization_id
    AND session.legacy_term_meeting_id = v_legacy.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting session projection disappeared before it could be archived.';
  END IF;

  v_after := jsonb_build_object(
    'request', v_request,
    'meetingId', v_legacy.id,
    'logicalMeetingId', v_logical.id,
    'sessionId', v_session.id,
    'archivedSessionIds', to_jsonb(v_archived_session_ids),
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
    'term_meeting.archive',
    'csf_term_meetings',
    v_legacy.id,
    p_term_id,
    v_before,
    v_after,
    p_request_id,
    'staff_action',
    v_legacy.id::text,
    'term_meeting_archived'
  );

  RETURN jsonb_build_object(
    'meetingId', v_legacy.id,
    'logicalMeetingId', v_logical.id,
    'sessionId', v_session.id,
    'operation', 'archived',
    'correlationId', p_request_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date[], timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Service-only, permission-checked, replay-safe meeting create/edit that reconciles the legacy row, logical meeting, one dated session per meeting date, and immutable audit receipt.';

COMMENT ON FUNCTION plugin_data.csf_upsert_term_meeting(
  uuid, uuid, uuid, text, date, timestamptz, text, text,
  boolean, integer, text, uuid, uuid
) IS 'Deprecated single-date wrapper for the date[] form; scheduled for removal once no caller remains.';

COMMENT ON FUNCTION plugin_data.csf_archive_term_meeting(
  uuid, uuid, uuid, uuid, uuid
) IS 'Service-only, permission-checked, replay-safe meeting archive that atomically archives every meeting projection (all dated sessions included) and writes its immutable audit receipt.';

COMMIT;
