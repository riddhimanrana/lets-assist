-- Historical imported attendance had no correction path once its semester
-- closed, and a retried correction wrote a second one.
--
-- Class-history imports write csf_meeting_attendance rows whose meeting_key
-- comes from a sheet column label. 20260829020011 gave every one of those a
-- canonical csf_term_meetings row and backfilled term_meeting_id, so
-- csf_correct_meeting_attendance can already reach them: an audit of the 12
-- committed class-history sources found all 9 meeting keys behind 2,470
-- proposed corrections, and all 4 behind 28 confirmed defects, already carry
-- stored attendance and therefore a canonical meeting.
--
-- Two things stopped an officer acting on that.
--
--   1. csf_guard_term_evidence_write refuses any write to
--      csf_meeting_attendance in a closed or archived semester. 20260916055000
--      gave that guard one escape, a transaction-local flag set by an officer
--      entrypoint after an explicit acknowledgement, and wired it into
--      csf_officer_save_profile_activity. csf_correct_meeting_attendance was
--      last replaced in 20260812220000, before the flag existed, so it never
--      sets it. A read-only audit on 2026-09-16 found S24, F24, S25, F25 and
--      S26 all open, so nothing is blocked today. This is the trap being
--      removed before anyone falls into it: the moment one of them closes, the
--      only route left is reopening and reclosing the whole semester, which is
--      the workaround 20260916055000 was written to remove.
--
--   2. The correlation id defaulted to gen_random_uuid() and the caller passed
--      null, so there was no replay key at all. A double-click or a retried
--      Server Action wrote a second attendance write and a second audit event.
--      This is finding C7 from 20260916080000, one table over.
--
-- What this does NOT do. It records an officer's decision; it does not make
-- one. No status is inferred from a cell fill, no date and no credit is
-- invented, and nothing here applies a correction in bulk. p_source_ref is
-- stored as evidence and never interpreted.
--
-- Append-only. No earlier migration is edited. The 8-argument entrypoints keep
-- their exact current behaviour: the wrapper below delegates with the
-- acknowledgement false and no source ref, which is what every existing caller
-- already means.

BEGIN;

-- The replay key. Partial and action-scoped so it constrains only these two
-- corrections, exactly as the profile-activity editor's index does for its own.
CREATE UNIQUE INDEX IF NOT EXISTS
  csf_admin_audit_events_attendance_correction_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action IN (
      'meeting.attendance_manual_corrected',
      'meeting.attendance_manual_removed'
    );

-- The atomic write, reproduced from its live definition in 20260716224500 with
-- exactly four edits: the two new arguments, the replay receipt, the
-- closed-semester acknowledgement, and the source ref in match_details.
CREATE OR REPLACE FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  p_organization_id uuid,
  p_meeting_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_acknowledge_closed_semester boolean,
  p_source_ref jsonb
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
  v_correlation_id uuid := coalesce(p_correlation_id, pg_catalog.gen_random_uuid());
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := pg_catalog.now();
  v_closed boolean := false;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request_digest text;
  v_source_ref jsonb :=
    CASE
      WHEN p_source_ref IS NULL THEN NULL
      WHEN pg_catalog.jsonb_typeof(p_source_ref) = 'object' THEN p_source_ref
      ELSE NULL
    END;
BEGIN
  IF p_operation NOT IN ('set', 'remove') THEN
    RAISE EXCEPTION 'Attendance correction operation must be set or remove.';
  END IF;
  IF p_operation = 'set' AND p_status NOT IN ('unknown', 'attended', 'excused', 'missed', 'not_required') THEN
    RAISE EXCEPTION 'Choose a valid attendance status.';
  END IF;
  IF nullif(pg_catalog.btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A manual attendance correction reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A manual attendance correction actor is required.';
  END IF;
  IF p_source_ref IS NOT NULL AND v_source_ref IS NULL THEN
    RAISE EXCEPTION 'Attendance correction source evidence must be a JSON object.';
  END IF;
  -- Evidence, with a shape. An open jsonb column becomes free text, and free
  -- text next to a decision starts getting read as the reason for it. These
  -- five keys say where the officer looked and nothing else; a source ref that
  -- cannot name its workbook is not evidence.
  IF v_source_ref IS NOT NULL THEN
    IF NOT (v_source_ref ? 'sourceId') THEN
      RAISE EXCEPTION 'Attendance correction source evidence must name its sourceId.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_source_ref) AS evidence_key
      WHERE evidence_key <> ALL (
        ARRAY['sourceId', 'tabName', 'sheetId', 'sheetRow', 'columnNumber']
      )
    ) THEN
      RAISE EXCEPTION 'Attendance correction source evidence may only name sourceId, tabName, sheetId, sheetRow and columnNumber.';
    END IF;
  END IF;

  -- A source reconciliation is the chapter fixing its own records against a
  -- workbook, one row at a time but hundreds of rows in an afternoon. Telling
  -- every member that their Spring 2025 attendance changed is noise about
  -- bookkeeping they were never wrong about. A correction an officer makes on
  -- its own merits carries no source ref and still notifies.
  --
  -- Transaction-local, so it cannot leak past this call. The reader lives in
  -- the communications lane; until that lands this flag is set and nothing
  -- consumes it, which is inert. The name must be reconciled with 0800 before
  -- either merges.
  IF v_source_ref IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.csf_suppress_notices', 'on', true);
  END IF;

  -- The payload this request is bound to. A replay has to be the same
  -- correction, not merely the same identifier: C7 found that comparing the
  -- action and the actor alone let a reused id report success having written a
  -- different change, or nothing at all.
  v_request_digest := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'meetingId', p_meeting_id,
          'profileId', p_profile_id,
          'operation', p_operation,
          'status', CASE WHEN p_operation = 'set' THEN p_status ELSE NULL END,
          'reason', pg_catalog.btrim(p_reason),
          'sourceRef', v_source_ref
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  IF p_correlation_id IS NOT NULL THEN
    -- Serialize same-request callers before the lookup, not after the write.
    -- Two retries arriving together would both miss the receipt, both proceed,
    -- and the second would block on the unique index and then fail rather than
    -- replay. The loser of this lock sees the winner's receipt below and
    -- returns it, which is what a retry is supposed to get.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || p_correlation_id::text,
        0
      )
    );
    SELECT audit.* INTO v_receipt
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_correlation_id
      AND audit.action IN (
        'meeting.attendance_manual_corrected',
        'meeting.attendance_manual_removed'
      )
    LIMIT 1;
    IF FOUND THEN
      IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
        OR v_receipt.after_data -> 'result' ->> 'requestDigest'
          IS DISTINCT FROM v_request_digest THEN
        RAISE EXCEPTION
          'That request identifier is already bound to a different attendance correction.';
      END IF;
      RETURN v_receipt.after_data -> 'result';
    END IF;
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

  -- Correcting a finished semester is a real thing an officer needs to do, and
  -- reopening the whole term to fix one row is why these rows stayed wrong. The
  -- guard yields only to an explicit acknowledgement, and the acknowledgement is
  -- recorded on the receipt below rather than merely acted on.
  SELECT term.lifecycle_status IN ('closed', 'archived') INTO v_closed
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_meeting.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The CSF semester for this meeting no longer exists.';
  END IF;
  IF v_closed THEN
    IF p_acknowledge_closed_semester IS NOT true THEN
      RAISE EXCEPTION 'This semester is closed. Confirm that you are correcting closed evidence before saving.'
        USING HINT = 'CSF_CLOSED_SEMESTER_ACKNOWLEDGEMENT_REQUIRED=true';
    END IF;
    PERFORM pg_catalog.set_config(
      'plugin_data.csf_closed_term_edit_attested', 'on', true
    );
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
    v_before := pg_catalog.jsonb_build_object(
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
      -- The first five keys are the live definition's, unchanged and in order,
      -- including their explicit nulls. The last three are added.
      pg_catalog.jsonb_build_object(
        'processor', 'manual_attendance_correction',
        'reason', p_reason,
        'correlationId', v_correlation_id,
        'previousSource', CASE WHEN v_existing_found THEN v_existing.source ELSE NULL END,
        'previousSourceRowId', CASE WHEN v_existing_found THEN v_existing.source_row_id ELSE NULL END,
        'previousStatus', CASE WHEN v_existing_found THEN v_existing.status ELSE NULL END,
        'closedSemesterAcknowledged', v_closed,
        -- Recorded, never read back as a decision. It says where the officer
        -- looked, not what the cell meant.
        'sourceRef', v_source_ref
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

    v_after := pg_catalog.jsonb_build_object(
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
    -- The change keeps every key and value it had, so an existing reader of
    -- after_data->>'status' or ->>'attendanceId' is unaffected. A removal used
    -- to write SQL NULL here, which carried no information; it now says so.
    coalesce(v_after, pg_catalog.jsonb_build_object('removed', true))
    || pg_catalog.jsonb_build_object(
      'closedSemesterAcknowledged', v_closed,
      'sourceRef', v_source_ref,
      -- The replay receipt. `result` is returned verbatim to a repeat call, so
      -- a retry cannot observe a different answer than the first call gave.
      'result', pg_catalog.jsonb_build_object(
        'attendanceId', v_attendance_id,
        'meetingId', v_meeting.id,
        'profileId', v_profile.id,
        'operation', p_operation,
        'status', CASE WHEN p_operation = 'set' THEN p_status ELSE NULL END,
        'correlationId', v_correlation_id,
        'closedSemesterAcknowledged', v_closed,
        'noticesSuppressed', v_source_ref IS NOT NULL,
        'requestDigest', v_request_digest
      )
    ),
    v_correlation_id,
    'manual_correction',
    v_meeting.id::text,
    CASE WHEN p_operation = 'remove'
      THEN 'manual_attendance_removed'
      ELSE 'manual_attendance_corrected'
    END
  );

  RETURN pg_catalog.jsonb_build_object(
    'attendanceId', v_attendance_id,
    'meetingId', v_meeting.id,
    'profileId', v_profile.id,
    'operation', p_operation,
    'status', CASE WHEN p_operation = 'set' THEN p_status ELSE NULL END,
    'correlationId', v_correlation_id,
    'closedSemesterAcknowledged', v_closed,
    'noticesSuppressed', v_source_ref IS NOT NULL,
    'requestDigest', v_request_digest
  );
END;
$$;

-- The permission wrapper, unchanged in what it checks.
CREATE OR REPLACE FUNCTION plugin_data.csf_correct_meeting_attendance(
  p_organization_id uuid,
  p_meeting_id uuid,
  p_profile_id uuid,
  p_operation text,
  p_status text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_acknowledge_closed_semester boolean,
  p_source_ref jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
  );
  RETURN plugin_data.csf_correct_meeting_attendance_permission_base(
    p_organization_id, p_meeting_id, p_profile_id, p_operation, p_status,
    p_reason, p_actor_user_id, p_correlation_id,
    p_acknowledge_closed_semester, p_source_ref
  );
END;
$$;

-- The 8-argument entrypoint keeps its exact current meaning. An existing caller
-- says nothing about a closed semester and carries no source ref, and that is
-- what false and null mean here, so its behaviour on an open semester is
-- identical and its refusal on a closed one is unchanged.
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
BEGIN
  PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
    p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
  );
  RETURN plugin_data.csf_correct_meeting_attendance_permission_base(
    p_organization_id, p_meeting_id, p_profile_id, p_operation, p_status,
    p_reason, p_actor_user_id, p_correlation_id, false, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
-- Owner-internal. The wrapper is SECURITY DEFINER and runs as the owner, so
-- this is the only role that needs it, and it is stated rather than left to the
-- default the way the neighbouring officer entrypoints state theirs.
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) IS 'Owner-only atomic attendance correction. Replays a bound request id, corrects a closed semester only on a recorded acknowledgement, and stores officer-supplied source evidence without interpreting it. Direct execution is revoked; call csf_correct_meeting_attendance.';

COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) IS 'Service-only manual attendance correction that rechecks active membership and exact reconcile_meeting_attendance authority under the shared staff-access lock, then writes atomically with a payload-bound replay receipt and a recorded closed-semester acknowledgement.';

COMMENT ON FUNCTION plugin_data.csf_correct_meeting_attendance(
  uuid, uuid, uuid, text, text, text, uuid, uuid
) IS 'Service-only manual attendance correction for an open semester. Delegates with no closed-semester acknowledgement and no source evidence, which is what a caller that passes neither already means.';

COMMIT;
