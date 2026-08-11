-- Make CSF import reconciliation decisions and commits crash-atomic.
-- These functions are intentionally server-only: permission-checked Server
-- Actions call them with the service role after authorizing the signed-in user.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  p_organization_id uuid,
  p_row_id uuid,
  p_profile_id uuid,
  p_decision text,
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
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_correlation_id uuid;
  v_partner_batch_id uuid;
  v_action text;
  v_reason_code text;
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('match', 'skip') THEN
    RAISE EXCEPTION 'Import-row reconciliation decision must be match or skip.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reconciliation reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A reconciliation actor is required.';
  END IF;

  SELECT import_row.*
  INTO v_row
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import row not found.';
  END IF;

  v_correlation_id := v_row.correlation_id;
  IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
    RAISE EXCEPTION 'The reconciliation correlation does not match the immutable import row.';
  END IF;

  IF p_decision = 'match' THEN
    IF p_profile_id IS NULL THEN
      RAISE EXCEPTION 'Choose the matching CSF member.';
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

    IF v_row.resolution_status = 'resolved'
      AND v_row.import_status = 'pending'
      AND v_row.matched_profile_id = p_profile_id
    THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'profileId', p_profile_id,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('ambiguous', 'conflict', 'duplicate') THEN
      RAISE EXCEPTION 'This row no longer needs a matching decision.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      matched_profile_id = p_profile_id,
      import_status = 'pending',
      errors = ARRAY[]::text[],
      resolution_status = 'resolved',
      resolution_reason_code = 'matched_existing_profile',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_match_resolved';
    v_reason_code := 'matched_existing_profile';
  ELSE
    IF v_row.resolution_status = 'ignored' AND v_row.import_status = 'skipped' THEN
      RETURN jsonb_build_object(
        'rowId', v_row.id,
        'decision', p_decision,
        'correlationId', v_correlation_id,
        'idempotent', true
      );
    END IF;

    IF v_row.import_status NOT IN ('pending', 'ambiguous', 'conflict', 'duplicate', 'error') THEN
      RAISE EXCEPTION 'This row has already been imported or skipped.';
    END IF;

    UPDATE plugin_data.csf_sheet_import_rows
    SET
      import_status = 'skipped',
      errors = ARRAY[]::text[],
      resolution_status = 'ignored',
      resolution_reason_code = 'officer_skipped',
      resolution_notes = p_reason,
      resolved_by = p_actor_user_id,
      resolved_at = v_now
    WHERE organization_id = p_organization_id
      AND id = p_row_id;

    v_action := 'sheets.row_skipped';
    v_reason_code := 'officer_skipped';
  END IF;

  BEGIN
    v_partner_batch_id := nullif(v_row.normalized_data->>'partnerAuditBatchId', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The partner-audit batch reference on this import row is invalid.';
  END;

  IF v_partner_batch_id IS NOT NULL AND v_row.row_hash IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_partner_submission_batches AS batch
      WHERE batch.organization_id = p_organization_id
        AND batch.id = v_partner_batch_id
    ) THEN
      RAISE EXCEPTION 'The linked partner-audit batch was not found in this organization.';
    END IF;

    UPDATE plugin_data.csf_partner_submission_rows
    SET
      profile_id = CASE WHEN p_decision = 'match' THEN p_profile_id ELSE profile_id END,
      matched_status = CASE WHEN p_decision = 'match' THEN 'matched' ELSE 'rejected' END
    WHERE organization_id = p_organization_id
      AND batch_id = v_partner_batch_id
      AND normalized_data #>> '{source,rowHash}' = v_row.row_hash;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_action,
    'csf_sheet_import_rows',
    v_row.id,
    v_row.term_id,
    jsonb_build_object(
      'decision', p_decision,
      'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
      'profileName', CASE
        WHEN p_decision = 'match' THEN btrim(concat_ws(' ', v_profile.first_name, v_profile.last_name))
        ELSE NULL
      END,
      'previousStatus', v_row.import_status,
      'jobId', v_row.job_id,
      'sourceId', v_row.source_id,
      'reason', p_reason
    ),
    v_correlation_id,
    'sheet_import',
    coalesce(v_row.source_id::text, v_row.job_id::text),
    v_reason_code
  );

  RETURN jsonb_build_object(
    'rowId', v_row.id,
    'decision', p_decision,
    'profileId', CASE WHEN p_decision = 'match' THEN p_profile_id ELSE NULL END,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_meeting plugin_data.csf_term_meetings%ROWTYPE;
  v_session plugin_data.csf_meeting_sessions%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_meeting_id uuid;
  v_attendance_id uuid;
  v_correlation_id uuid;
  v_committed_profiles uuid[] := ARRAY[]::uuid[];
  v_created integer := 0;
  v_unchanged integer := 0;
  v_failed integer := 0;
  v_pending_count integer := 0;
  v_final_status text;
  v_now timestamptz := now();
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit actor is required.';
  END IF;

  SELECT job.*
  INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_preview.mode <> 'preview' OR v_preview.source_type <> 'meeting_attendance' THEN
    RAISE EXCEPTION 'Choose a meeting-attendance preview.';
  END IF;
  IF v_preview.source_id IS NULL OR v_preview.status NOT IN ('completed', 'needs_resolution') THEN
    RAISE EXCEPTION 'The attendance preview is not ready to commit.';
  END IF;

  v_correlation_id := v_preview.correlation_id;
  IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
    RAISE EXCEPTION 'The commit correlation does not match the immutable attendance preview.';
  END IF;

  SELECT job.*
  INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.mode = 'commit'
    AND job.source_type = 'meeting_attendance'
    AND job.summary->>'previewJobId' = v_preview.id::text
  ORDER BY job.created_at, job.id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'jobId', v_commit.id,
      'previewJobId', v_preview.id,
      'created', coalesce((v_commit.summary->>'created')::integer, 0),
      'unchanged', coalesce((v_commit.summary->>'unchanged')::integer, 0),
      'failed', coalesce((v_commit.summary->>'failed')::integer, 0),
      'status', v_commit.status,
      'correlationId', v_commit.correlation_id,
      'idempotent', true
    );
  END IF;

  SELECT count(*)::integer
  INTO v_pending_count
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = v_preview.id
    AND import_row.import_status = 'pending';

  IF v_pending_count = 0 THEN
    RAISE EXCEPTION 'Resolve at least one attendance row before committing.';
  END IF;

  BEGIN
    SELECT nullif(import_row.normalized_data->>'meetingId', '')::uuid
    INTO v_meeting_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
    ORDER BY import_row.row_number, import_row.id
    LIMIT 1;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The attendance preview contains an invalid meeting reference.';
  END;

  IF v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'The meeting for this preview no longer exists.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
      AND import_row.normalized_data->>'meetingId' IS DISTINCT FROM v_meeting_id::text
  ) THEN
    RAISE EXCEPTION 'One attendance preview cannot contain rows for multiple meetings.';
  END IF;

  SELECT meeting.*
  INTO v_meeting
  FROM plugin_data.csf_term_meetings AS meeting
  WHERE meeting.organization_id = p_organization_id
    AND meeting.id = v_meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The meeting for this preview no longer exists.';
  END IF;

  SELECT session.*
  INTO v_session
  FROM plugin_data.csf_meeting_sessions AS session
  WHERE session.organization_id = p_organization_id
    AND session.legacy_term_meeting_id = v_meeting.id
  LIMIT 1;

  INSERT INTO plugin_data.csf_sheet_import_jobs (
    organization_id,
    source_id,
    initiated_by,
    mode,
    status,
    source_type,
    source_file_id,
    source_file_name,
    source_sheet_tab,
    source_range,
    source_modified_at,
    source_file_metadata,
    mapping_snapshot,
    mapping_version,
    correlation_id,
    summary,
    started_at
  ) VALUES (
    p_organization_id,
    v_preview.source_id,
    p_actor_user_id,
    'commit',
    'running',
    'meeting_attendance',
    v_preview.source_file_id,
    v_preview.source_file_name,
    v_preview.source_sheet_tab,
    v_preview.source_range,
    v_preview.source_modified_at,
    v_preview.source_file_metadata,
    v_preview.mapping_snapshot,
    v_preview.mapping_version,
    v_correlation_id,
    jsonb_build_object('previewJobId', v_preview.id),
    v_now
  )
  RETURNING * INTO v_commit;

  FOR v_row IN
    SELECT import_row.*
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
    ORDER BY import_row.row_number, import_row.id
    FOR UPDATE
  LOOP
    IF v_row.matched_profile_id IS NULL
      OR v_row.term_id IS NULL
      OR v_row.matched_profile_id = ANY(v_committed_profiles)
    THEN
      v_failed := v_failed + 1;
      UPDATE plugin_data.csf_sheet_import_rows
      SET
        import_status = 'duplicate',
        errors = ARRAY['Only one attendance record per member can be committed for this meeting.']::text[]
      WHERE organization_id = p_organization_id
        AND id = v_row.id;
      CONTINUE;
    END IF;

    IF v_row.term_id <> v_meeting.term_id THEN
      RAISE EXCEPTION 'Attendance row % belongs to a different semester.', v_row.id;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_row.matched_profile_id
        AND profile.record_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Attendance row % references a member outside this organization.', v_row.id;
    END IF;

    v_committed_profiles := array_append(v_committed_profiles, v_row.matched_profile_id);
    v_attendance_id := NULL;

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
      submitted_name,
      submitted_email,
      source_submitted_at,
      match_status,
      match_confidence,
      match_details
    ) VALUES (
      p_organization_id,
      v_row.matched_profile_id,
      v_meeting.term_id,
      v_meeting.id,
      v_session.meeting_id,
      v_session.id,
      v_meeting.meeting_key,
      v_meeting.label,
      'attended',
      'sheet',
      v_row.id,
      p_actor_user_id,
      nullif(v_row.normalized_data->>'submittedName', ''),
      nullif(v_row.normalized_data->>'submittedEmail', ''),
      nullif(v_row.normalized_data->>'sourceSubmittedAt', '')::timestamptz,
      'confirmed',
      CASE WHEN nullif(v_row.normalized_data->>'normalizedEmail', '') IS NOT NULL THEN 1 ELSE 0.9 END,
      jsonb_build_object(
        'importJobId', v_preview.id,
        'importRowId', v_row.id,
        'rowNumber', v_row.row_number,
        'rowHash', v_row.row_hash,
        'correlationId', v_correlation_id,
        'reason', p_reason
      )
    )
    ON CONFLICT (profile_id, term_id, meeting_key) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
      v_unchanged := v_unchanged + 1;
      UPDATE plugin_data.csf_sheet_import_rows
      SET
        import_status = 'duplicate',
        errors = ARRAY['Attendance already exists and was not overwritten.']::text[]
      WHERE organization_id = p_organization_id
        AND id = v_row.id;
    ELSE
      v_created := v_created + 1;
      UPDATE plugin_data.csf_sheet_import_rows
      SET import_status = 'created'
      WHERE organization_id = p_organization_id
        AND id = v_row.id;
    END IF;
  END LOOP;

  v_final_status := CASE
    WHEN v_failed > 0 OR v_unchanged > 0 THEN 'partially_completed'
    ELSE 'completed'
  END;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET
    status = v_final_status,
    summary = jsonb_build_object(
      'previewJobId', v_preview.id,
      'created', v_created,
      'unchanged', v_unchanged,
      'failed', v_failed,
      'reason', p_reason
    ),
    committed_at = v_now,
    completed_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_commit.id;

  UPDATE plugin_data.csf_sheet_sources
  SET
    sync_status = CASE WHEN v_final_status = 'completed' THEN 'healthy' ELSE 'needs_attention' END,
    last_sync_status = 'commit_' || v_final_status,
    last_sync_error = CASE
      WHEN v_failed > 0 THEN v_failed || ' row' || CASE WHEN v_failed = 1 THEN '' ELSE 's' END || ' failed.'
      ELSE NULL
    END,
    last_committed_at = v_now,
    last_synced_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_preview.source_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term_meeting.attendance_commit',
    'csf_term_meetings',
    v_meeting.id,
    v_meeting.term_id,
    jsonb_build_object(
      'previewJobId', v_preview.id,
      'commitJobId', v_commit.id,
      'created', v_created,
      'unchanged', v_unchanged,
      'failed', v_failed,
      'reason', p_reason
    ),
    v_correlation_id,
    'sheet_import',
    v_preview.source_id::text,
    'meeting_attendance_committed'
  );

  RETURN jsonb_build_object(
    'jobId', v_commit.id,
    'previewJobId', v_preview.id,
    'created', v_created,
    'unchanged', v_unchanged,
    'failed', v_failed,
    'status', v_final_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_partner_audit_import(
  p_organization_id uuid,
  p_batch_id uuid,
  p_approval_mode text,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_partner_submission_batches%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_partner_submission_rows%ROWTYPE;
  v_submission_id uuid;
  v_credit_id uuid;
  v_preview_job_id uuid;
  v_correlation_id uuid;
  v_row_hash text;
  v_generated integer := 0;
  v_failed integer := 0;
  v_unresolved integer := 0;
  v_final_status text;
  v_now timestamptz := now();
BEGIN
  IF p_approval_mode NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Invalid approval mode.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A partner-audit commit reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A partner-audit commit actor is required.';
  END IF;

  SELECT batch.*
  INTO v_batch
  FROM plugin_data.csf_partner_submission_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.term_id IS NULL THEN
    RAISE EXCEPTION 'Audit batch or term was not found.';
  END IF;

  IF v_batch.summary ? 'atomicCommitCorrelationId' THEN
    RETURN jsonb_build_object(
      'batchId', v_batch.id,
      'jobId', nullif(v_batch.summary->>'sheetImportCommitJobId', '')::uuid,
      'generated', coalesce((v_batch.summary->>'generated')::integer, 0),
      'unresolved', coalesce((v_batch.summary->>'unresolvedImportRows')::integer, 0),
      'failed', coalesce((v_batch.summary->>'failedImportRows')::integer, 0),
      'correlationId', (v_batch.summary->>'atomicCommitCorrelationId')::uuid,
      'idempotent', true
    );
  END IF;

  BEGIN
    v_preview_job_id := nullif(v_batch.summary->>'sheetImportPreviewJobId', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The partner-audit batch contains an invalid preview reference.';
  END;

  IF v_preview_job_id IS NOT NULL THEN
    SELECT job.*
    INTO v_preview
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.id = v_preview_job_id
      AND job.mode = 'preview'
      AND job.source_type = 'partner_club_audit'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The linked partner-audit preview was not found in this organization.';
    END IF;

    v_correlation_id := v_preview.correlation_id;
    IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
      RAISE EXCEPTION 'The commit correlation does not match the immutable partner-audit preview.';
    END IF;

    SELECT job.*
    INTO v_commit
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.mode = 'commit'
      AND job.source_type = 'partner_club_audit'
      AND job.summary->>'previewJobId' = v_preview.id::text
    ORDER BY job.created_at, job.id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'batchId', v_batch.id,
        'jobId', v_commit.id,
        'generated', coalesce((v_commit.summary->>'created')::integer, 0),
        'unresolved', coalesce((v_commit.summary->>'ambiguous')::integer, 0),
        'failed', coalesce((v_commit.summary->>'failed')::integer, 0),
        'correlationId', v_commit.correlation_id,
        'idempotent', true
      );
    END IF;
  ELSE
    v_correlation_id := coalesce(p_correlation_id, gen_random_uuid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_batch.term_id
  ) THEN
    RAISE EXCEPTION 'The partner-audit term does not belong to this organization.';
  END IF;

  IF v_preview_job_id IS NOT NULL THEN
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id,
      source_id,
      initiated_by,
      mode,
      status,
      source_type,
      source_file_id,
      source_file_name,
      source_sheet_tab,
      source_range,
      source_modified_at,
      source_file_metadata,
      mapping_snapshot,
      mapping_version,
      correlation_id,
      summary,
      started_at
    ) VALUES (
      p_organization_id,
      v_preview.source_id,
      p_actor_user_id,
      'commit',
      'running',
      'partner_club_audit',
      v_preview.source_file_id,
      v_preview.source_file_name,
      v_preview.source_sheet_tab,
      v_preview.source_range,
      v_preview.source_modified_at,
      v_preview.source_file_metadata,
      v_preview.mapping_snapshot,
      v_preview.mapping_version,
      v_correlation_id,
      jsonb_build_object('previewJobId', v_preview.id, 'partnerAuditBatchId', v_batch.id),
      v_now
    )
    RETURNING * INTO v_commit;
  END IF;

  FOR v_row IN
    SELECT partner_row.*
    FROM plugin_data.csf_partner_submission_rows AS partner_row
    WHERE partner_row.organization_id = p_organization_id
      AND partner_row.batch_id = v_batch.id
      AND partner_row.matched_status = 'matched'
      AND partner_row.profile_id IS NOT NULL
      AND partner_row.generated_submission_id IS NULL
    ORDER BY partner_row.created_at, partner_row.id
    FOR UPDATE
  LOOP
    IF v_row.claimed_points IS NULL
      OR v_row.claimed_points <= 0
      OR v_row.point_type IS NULL
      OR v_row.point_type NOT IN ('non_drive', 'drive')
    THEN
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_row.profile_id
        AND profile.record_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Partner-audit row % references a member outside this organization.', v_row.id;
    END IF;

    INSERT INTO plugin_data.csf_point_submissions (
      organization_id,
      profile_id,
      term_id,
      source,
      description,
      claimed_points,
      point_type,
      status,
      submitted_by,
      reviewed_by,
      reviewed_at,
      review_notes
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      'sheet',
      v_batch.title || ' partner club audit',
      v_row.claimed_points,
      v_row.point_type,
      CASE WHEN p_approval_mode = 'approved' THEN 'approved' ELSE 'submitted' END,
      p_actor_user_id,
      CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN p_reason ELSE NULL END
    )
    RETURNING id INTO v_submission_id;

    INSERT INTO plugin_data.csf_credit_records (
      organization_id,
      profile_id,
      term_id,
      submission_id,
      source,
      points,
      point_type,
      status,
      verified_by,
      verified_at,
      evidence
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      v_submission_id,
      'sheet',
      v_row.claimed_points,
      v_row.point_type,
      CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'pending' END,
      CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
      jsonb_build_object(
        'partnerAuditBatchId', v_batch.id,
        'partnerAuditRowId', v_row.id,
        'sourceUrl', v_batch.source_url,
        'normalizedData', v_row.normalized_data,
        'correlationId', v_correlation_id,
        'reason', p_reason
      )
    )
    RETURNING id INTO v_credit_id;

    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id,
      profile_id,
      term_id,
      credit_record_id,
      event_type,
      title,
      description,
      point_type,
      raw_points,
      counted_points,
      status,
      source,
      source_ref
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      v_credit_id,
      'opportunity',
      v_batch.title,
      'Partner club audit credit',
      v_row.point_type,
      v_row.claimed_points,
      v_row.claimed_points,
      CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'pending' END,
      'sheet',
      jsonb_build_object(
        'partnerAuditBatchId', v_batch.id,
        'partnerAuditRowId', v_row.id,
        'correlationId', v_correlation_id
      )
    );

    UPDATE plugin_data.csf_partner_submission_rows
    SET generated_submission_id = v_submission_id
    WHERE organization_id = p_organization_id
      AND batch_id = v_batch.id
      AND id = v_row.id;

    v_row_hash := v_row.normalized_data #>> '{source,rowHash}';
    IF v_preview_job_id IS NOT NULL AND nullif(v_row_hash, '') IS NOT NULL THEN
      UPDATE plugin_data.csf_sheet_import_rows
      SET
        import_status = 'created',
        matched_profile_id = v_row.profile_id
      WHERE organization_id = p_organization_id
        AND job_id = v_preview_job_id
        AND row_hash = v_row_hash
        AND import_status = 'pending';
    END IF;

    v_generated := v_generated + 1;
  END LOOP;

  IF v_preview_job_id IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_unresolved
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview_job_id
      AND import_row.import_status IN ('pending', 'ambiguous', 'conflict', 'duplicate', 'error');

    v_final_status := CASE
      WHEN v_unresolved > 0 OR v_failed > 0 THEN 'partially_completed'
      ELSE 'completed'
    END;

    UPDATE plugin_data.csf_sheet_import_jobs
    SET
      status = v_final_status,
      summary = jsonb_build_object(
        'previewJobId', v_preview_job_id,
        'partnerAuditBatchId', v_batch.id,
        'committed', v_generated,
        'created', v_generated,
        'updated', 0,
        'ambiguous', v_unresolved,
        'failed', v_failed,
        'reason', p_reason
      ),
      committed_at = v_now,
      completed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_commit.id;

    UPDATE plugin_data.csf_sheet_sources
    SET
      sync_status = CASE WHEN v_final_status = 'completed' THEN 'healthy' ELSE 'needs_attention' END,
      last_sync_status = 'commit_' || v_final_status,
      last_sync_error = CASE
        WHEN v_unresolved > 0 OR v_failed > 0
          THEN v_unresolved || ' row' || CASE WHEN v_unresolved = 1 THEN ' remains' ELSE 's remain' END
            || ' unresolved; ' || v_failed || ' failed.'
        ELSE NULL
      END,
      last_committed_at = v_now,
      last_synced_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_preview.source_id;
  ELSE
    v_final_status := CASE WHEN v_failed > 0 THEN 'partially_completed' ELSE 'completed' END;
  END IF;

  UPDATE plugin_data.csf_partner_submission_batches
  SET
    status = CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'needs_verification' END,
    reviewed_by = CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
    reviewed_at = CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
    summary = v_batch.summary || jsonb_build_object(
      'sheetImportCommitJobId', v_commit.id,
      'generated', v_generated,
      'unresolvedImportRows', v_unresolved,
      'failedImportRows', v_failed,
      'atomicCommitCorrelationId', v_correlation_id,
      'commitReason', p_reason
    ),
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_batch.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_audit.commit',
    'csf_partner_submission_batches',
    v_batch.id,
    v_batch.term_id,
    jsonb_build_object(
      'generated', v_generated,
      'approvalMode', p_approval_mode,
      'previewJobId', v_preview_job_id,
      'commitJobId', v_commit.id,
      'unresolvedImportRows', v_unresolved,
      'failed', v_failed,
      'reason', p_reason
    ),
    v_correlation_id,
    CASE WHEN v_preview_job_id IS NOT NULL THEN 'sheet_import' ELSE 'partner_audit' END,
    coalesce(v_preview.source_id::text, v_batch.id::text),
    'partner_audit_committed'
  );

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'jobId', v_commit.id,
    'generated', v_generated,
    'unresolved', v_unresolved,
    'failed', v_failed,
    'status', v_final_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) IS
  'Atomically records an officer import-row match/skip decision, applies its linked partner-audit row change, and writes immutable audit history.';
COMMENT ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid
) IS
  'Atomically commits one reconciled meeting-attendance preview, preserving existing officer corrections and writing source/job/audit state together.';
COMMENT ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid
) IS
  'Atomically turns reconciled partner-audit rows into submissions, credits, activity history, import state, batch state, and immutable audit history.';

COMMIT;
