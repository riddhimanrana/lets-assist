-- Preserve every retired source and class, and bind attendance retries to acknowledgement.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_retention_commit(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_run_id uuid,
  p_profile_digest text,
  p_graduation_years integer[],
  p_profile_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run plugin_data.csf_retention_runs%ROWTYPE;
  v_counts jsonb := '{}'::jsonb;
  v_gap_count integer;
  v_sealed uuid[];
  v_fresh uuid[];
  v_profile_id uuid;
  v_deleted jsonb;
  v_retained integer;
  v_blockers text[];
  v_disposition text;
  v_cohort_id uuid;
  v_graduation_year integer;
  v_closed_terms integer;
  v_target_cohort_ids uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  PERFORM 1
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    AND plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_settings')
  ) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  -- The profile-identity lock the merge path takes, for the same reason: no
  -- concurrent merge, class-code join or import may be rewriting these rows.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT run.* INTO v_run
  FROM plugin_data.csf_retention_runs AS run
  WHERE run.id = p_run_id
    AND run.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That retention preview does not belong to this organization.'
      USING ERRCODE = '55000';
  END IF;

  -- Bind the whole payload before anything else. An exact replay of the same
  -- committed intent returns the original receipt; a request that differs in
  -- actor, years, digest or profile set is a different intent and is refused,
  -- committed or not (V116).
  IF v_run.graduation_years IS DISTINCT FROM p_graduation_years
    OR v_run.profile_digest IS DISTINCT FROM p_profile_digest
    OR plugin_data.csf_retention_profile_set_digest(p_profile_ids)
       IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION 'The retention request does not match its sealed preview.'
      USING ERRCODE = '55000';
  END IF;

  IF v_run.state = 'committed' THEN
    IF v_run.commit_request_id IS DISTINCT FROM p_request_id
      OR v_run.committed_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'This retention preview was already committed by a different request.'
        USING ERRCODE = '55000';
    END IF;
    RETURN plugin_data.csf_retention_run_summary(v_run.id);
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_gap_count
  FROM (
    SELECT 1 FROM plugin_data.csf_retention_reference_coverage_gaps()
    UNION ALL
    SELECT 1 FROM plugin_data.csf_retention_identity_coverage_gaps()
  ) AS gap;

  IF v_gap_count > 0 OR pg_catalog.jsonb_array_length(v_run.coverage_gaps) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A CSF record or column is not classified by this retention operation.',
      DETAIL = 'CSF_RETENTION_UNCLASSIFIED=' || v_gap_count::text,
      HINT = 'Classify it in csf_retention_reference_policy or csf_retention_identity_inventory before erasing anything.';
  END IF;

  SELECT coalesce(pg_catalog.array_agg(preview.profile_id ORDER BY preview.profile_id), ARRAY[]::uuid[])
  INTO v_sealed
  FROM plugin_data.csf_retention_preview_profiles AS preview
  WHERE preview.run_id = v_run.id
    AND preview.disposition <> 'blocked';

  IF plugin_data.csf_retention_profile_set_digest(v_sealed)
    IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION 'The sealed preview no longer describes its own profile set.'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.cardinality(v_sealed) = 0 THEN
    RAISE EXCEPTION 'This preview has nothing to erase.' USING ERRCODE = '55000';
  END IF;

  -- The fresh eligible set, recomputed now, under lock. Set equality in both
  -- directions: a profile that has left the candidate list -- moved to a
  -- current class, merged away, deleted -- fails here instead of being passed
  -- over by a join.
  SELECT coalesce(pg_catalog.array_agg(fresh.profile_id ORDER BY fresh.profile_id), ARRAY[]::uuid[])
  INTO v_fresh
  FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS fresh
  WHERE pg_catalog.cardinality(fresh.blockers) = 0;

  IF plugin_data.csf_retention_profile_set_digest(v_fresh)
    IS DISTINCT FROM v_run.profile_digest THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'The eligible set has changed since this preview was sealed.',
      DETAIL = 'CSF_RETENTION_SCOPE_DRIFT sealed=' || pg_catalog.cardinality(v_sealed)::text
        || ' fresh=' || pg_catalog.cardinality(v_fresh)::text,
      HINT = 'Take a fresh preview and have an officer confirm it.';
  END IF;

  -- Capture all selected class identities before deleting the memberships.
  -- The preview has one row per profile, which cannot represent every class.
  SELECT coalesce(pg_catalog.array_agg(DISTINCT cohort.id ORDER BY cohort.id), ARRAY[]::uuid[])
  INTO v_target_cohort_ids
  FROM plugin_data.csf_cohorts AS cohort
  JOIN plugin_data.csf_profile_cohort_memberships AS membership
    ON membership.organization_id = cohort.organization_id
   AND membership.cohort_id = cohort.id
  WHERE cohort.organization_id = p_organization_id
    AND cohort.graduation_year = ANY(p_graduation_years)
    AND membership.profile_id = ANY(v_sealed);

  -- Some of these semesters are closed and some are open. Raise the reviewed
  -- attestation either way, after authorization, and record what was actually
  -- in scope. No trigger is disabled.
  SELECT pg_catalog.count(DISTINCT term.id)::integer INTO v_closed_terms
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.lifecycle_status IN ('closed', 'archived')
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_term_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.term_id = term.id
        AND membership.profile_id = ANY(v_sealed)
    );

  PERFORM pg_catalog.set_config('plugin_data.csf_closed_term_edit_attested', 'on', true);
  PERFORM pg_catalog.set_config('plugin_data.csf_retention_in_progress', 'on', true);

  -- Retiring 543 students must not become 543 emails. 20260917080000 already
  -- built the lane for exactly this -- its own comment names retention -- so
  -- use it rather than a second mechanism: `csf_suppress_publication_notices()`
  -- sets `app.csf_suppress_notices` for this transaction, and
  -- `csf_record_personal_notification` then records nothing at all, so there is
  -- no queued notice for a later worker to find.
  --
  -- The direct set_config is the same switch, not a second one. It is here so
  -- this migration still replays in a tree that does not yet carry 080000; the
  -- flag name is the contract either way.
  PERFORM pg_catalog.set_config('app.csf_suppress_notices', 'on', true);

  IF pg_catalog.to_regprocedure('plugin_data.csf_suppress_publication_notices()') IS NOT NULL THEN
    EXECUTE 'SELECT plugin_data.csf_suppress_publication_notices()';
  END IF;

  FOREACH v_profile_id IN ARRAY v_sealed LOOP
    PERFORM 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_profile_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A profile in this preview no longer exists. Take a fresh preview.'
        USING ERRCODE = '55000';
    END IF;

    -- Disposition and reference counts are re-derived here, after the row
    -- lock. The sealed preview decides *which* profiles; the live database
    -- decides what may be done to each of them. A missing fresh row is a
    -- failure, never an assumption of zero retained references.
    SELECT fresh.blockers, fresh.retained_reference_count, fresh.cohort_id, fresh.graduation_year
    INTO v_blockers, v_retained, v_cohort_id, v_graduation_year
    FROM plugin_data.csf_retention_candidates(p_organization_id, p_graduation_years) AS fresh
    WHERE fresh.profile_id = v_profile_id;

    IF NOT FOUND OR v_blockers IS NULL OR pg_catalog.cardinality(v_blockers) > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'A profile in this preview is no longer eligible.',
        DETAIL = 'CSF_RETENTION_PROFILE_INELIGIBLE=' || v_profile_id::text,
        HINT = 'Take a fresh preview and have an officer confirm it.';
    END IF;

    v_disposition := plugin_data.csf_retention_disposition(v_blockers, v_retained);

    -- Proof and application objects leave through the reviewed storage queue
    -- (V27), before the file rows that name them go.
    INSERT INTO plugin_data.csf_storage_deletion_queue (organization_id, submission_file_id, bucket, object_path)
    SELECT p_organization_id, proof.id, proof.bucket, proof.object_path
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.profile_id = v_profile_id
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;

    INSERT INTO plugin_data.csf_storage_deletion_queue (organization_id, bucket, object_path)
    SELECT p_organization_id, attachment.bucket, attachment.object_path
    FROM plugin_data.csf_application_files AS attachment
    WHERE attachment.organization_id = p_organization_id
      AND attachment.profile_id = v_profile_id
    ON CONFLICT ON CONSTRAINT csf_storage_deletion_queue_bucket_path_key DO NOTHING;

    -- Record the immutable fingerprint of the source rows that produced this
    -- student, before the records that link to them go. A row with no
    -- fingerprint cannot be identified without falling back to position, so it
    -- is not tombstoned at all rather than tombstoned wrongly.
    INSERT INTO plugin_data.csf_retention_source_tombstones (
      organization_id, run_id, source_id, row_hash, sheet_tab_name, row_number
    )
    SELECT DISTINCT
      p_organization_id, v_run.id, import_row.source_id, import_row.row_hash,
      import_row.sheet_tab_name, import_row.row_number
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.row_hash IS NOT NULL
      AND pg_catalog.btrim(import_row.row_hash) <> ''
      AND (
        import_row.matched_profile_id = v_profile_id
        OR import_row.commit_target_profile_id = v_profile_id
        OR EXISTS (
          SELECT 1 FROM plugin_data.csf_term_applications AS application
          WHERE application.organization_id = p_organization_id
            AND application.profile_id = v_profile_id
            AND application.id = import_row.matched_application_id
        )
      )
    ON CONFLICT ON CONSTRAINT csf_retention_source_tombstone_key DO NOTHING;

    v_deleted := plugin_data.csf_retention_delete_owned_records(p_organization_id, v_profile_id);

    IF v_disposition = 'erase_and_delete' THEN
      DELETE FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_profile_id;
    ELSE
      -- The row stays so the immutable references keep resolving. What the row
      -- says about a person does not. Every column listed as `erase` in the
      -- identity inventory appears here.
      UPDATE plugin_data.csf_profiles AS profile
      SET first_name = 'Erased',
          middle_name = NULL,
          last_name = 'Record',
          preferred_name = NULL,
          nicknames = ARRAY[]::text[],
          school_email = NULL,
          personal_email = NULL,
          normalized_first_name = 'erased',
          normalized_last_name = 'record',
          normalized_school_email = NULL,
          normalized_personal_email = NULL,
          reported_application_school_email = NULL,
          reported_application_personal_email = NULL,
          privacy_flags = '{}'::jsonb,
          source_summary = '{}'::jsonb,
          merge_reason = NULL,
          record_status = 'retention_erased',
          updated_at = now()
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_profile_id;
    END IF;

    INSERT INTO plugin_data.csf_retention_profile_tombstones (
      organization_id, run_id, profile_id, cohort_id, graduation_year,
      disposition, deleted_row_counts, retained_references
    )
    VALUES (
      p_organization_id, v_run.id, v_profile_id, v_cohort_id, v_graduation_year,
      v_disposition, v_deleted,
      pg_catalog.jsonb_build_object('immutableReferenceCount', v_retained)
    );

    v_counts := v_counts || pg_catalog.jsonb_build_object(v_disposition,
      coalesce((v_counts ->> v_disposition)::integer, 0) + 1);
  END LOOP;

  v_counts := v_counts || pg_catalog.jsonb_build_object('closedSemestersInScope', v_closed_terms);

  INSERT INTO plugin_data.csf_retention_retired_cohorts (
    organization_id, cohort_id, run_id, graduation_year
  )
  SELECT p_organization_id, cohort.id, v_run.id, cohort.graduation_year
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = ANY(v_target_cohort_ids)
  ON CONFLICT (organization_id, cohort_id) DO NOTHING;

  UPDATE plugin_data.csf_retention_runs AS run
  SET state = 'committed',
      committed_at = now(),
      committed_by = p_actor_user_id,
      commit_request_id = p_request_id,
      committed_counts = v_counts
  WHERE run.id = v_run.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action,
    target_type, target_id, before_data, after_data, correlation_id, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id, NULL, 'retention.graduated_cohorts_retired',
    'csf_retention_runs', v_run.id, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'graduationYears', pg_catalog.to_jsonb(p_graduation_years),
      'profileDigest', v_run.profile_digest,
      'counts', v_counts,
      'reason', v_run.reason,
      'immutableEvidenceRetained', true
    ),
    p_request_id, 'graduated_cohort_retention'
  );

  RETURN plugin_data.csf_retention_run_summary(v_run.id);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_retention_commit(uuid, uuid, uuid, uuid, text, integer[], uuid[])
  TO postgres, service_role;

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
          'sourceRef', v_source_ref,
          'acknowledgeClosedSemester', p_acknowledge_closed_semester
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
      -- Beside the acknowledgement, not only inside the replay receipt. Whether
      -- the member was told is a fact about this correction, and an auditor
      -- reading after_data should not have to know that `result` exists to find
      -- it.
      'noticesSuppressed', v_source_ref IS NOT NULL,
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

REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(
  uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb
) TO postgres;

COMMIT;
