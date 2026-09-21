-- Keep partial attendance batches in one logical commit, with fresh evidence
-- and a separate audit event for each newly resolved population.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_meeting_attendance_import_identity_base(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid,
  p_allow_unresolved boolean
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
  v_match_metadata jsonb;
  v_correlation_id uuid;
  v_blockers text[];
  v_committed_profiles uuid[] := ARRAY[]::uuid[];
  v_prior_created integer := 0;
  v_prior_unchanged integer := 0;
  v_created integer := 0;
  v_unchanged integer := 0;
  -- Retained because `failed` is a published key of the commit-job summary, the audit
  -- event and this function's return value. It can no longer be incremented: every path
  -- that used to increment it now raises and rolls the whole commit back.
  v_failed integer := 0;
  v_pending_count integer := 0;
  v_remaining_unresolved integer := 0;
  v_allow_unresolved boolean := coalesce(p_allow_unresolved, false);
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
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 1;

  IF FOUND THEN
    -- A settled snapshot replays as a read. In the partial-commit mode a
    -- follow-up commit is legitimate exactly when officer or AI resolution
    -- has produced new committable pending rows since the last commit;
    -- with none, this replays the latest commit instead of writing another.
    IF NOT v_allow_unresolved
      OR NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_sheet_import_rows AS import_row
        WHERE import_row.organization_id = p_organization_id
          AND import_row.job_id = v_preview.id
          AND import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NOT NULL
      ) THEN
      RETURN jsonb_build_object(
        'jobId', v_commit.id,
        'previewJobId', v_preview.id,
        'created', coalesce((v_commit.summary->'lastBatch'->>'created')::integer, (v_commit.summary->>'created')::integer, 0),
        'unchanged', coalesce((v_commit.summary->'lastBatch'->>'unchanged')::integer, (v_commit.summary->>'unchanged')::integer, 0),
        'failed', coalesce((v_commit.summary->>'failed')::integer, 0),
        'remainingUnresolved', coalesce((v_commit.summary->>'remainingUnresolved')::integer, 0),
        'status', v_commit.status,
        'correlationId', v_commit.correlation_id,
        'idempotent', true
      );
    END IF;
  END IF;

  -- The whole authoritative population, locked in the one canonical order, BEFORE
  -- readiness is read (see 20260811170000).
  PERFORM plugin_data.csf_lock_contextual_commit_population(
    p_organization_id, v_preview.id, NULL
  );

  -- Whole-preview readiness under those locks. The partial mode drops only
  -- the shared "unreconciled siblings" sentence: ambiguous, conflict and
  -- duplicate rows are precisely what it commits around. Unreadable rows and
  -- commit-outcome recovery states still refuse the commit in both modes, as
  -- does a pending row with no member or semester and a member named twice.
  v_blockers := plugin_data.csf_import_preview_row_readiness_blockers(
    p_organization_id, v_preview.id
  );
  IF v_allow_unresolved AND pg_catalog.array_length(v_blockers, 1) IS NOT NULL THEN
    SELECT coalesce(pg_catalog.array_agg(blocker), ARRAY[]::text[])
    INTO v_blockers
    FROM pg_catalog.unnest(v_blockers) AS blocker
    WHERE blocker NOT LIKE 'Reconcile %conflicting row(s) before importing.';
  END IF;
  IF pg_catalog.array_length(v_blockers, 1) IS NULL THEN
    v_blockers := plugin_data.csf_meeting_attendance_preview_readiness_blockers(
      p_organization_id, v_preview.id
    );
  END IF;
  IF pg_catalog.array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION '%', v_blockers[1];
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

  -- The source, re-proved in this transaction, immediately before the first
  -- write (see 20260811170000 for why there is no null-tolerant branch).
  PERFORM plugin_data.csf_consume_sheet_source_evidence(
    p_organization_id, v_preview.source_id, p_actor_user_id, p_evidence_token, v_preview.id
  );

  -- One logical commit owns the preview. Each later batch has fresh source
  -- evidence and its own audit event, while keeping the original provenance.
  IF v_commit.id IS NULL THEN
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
  ELSE
    v_prior_created := coalesce((v_commit.summary->>'created')::integer, 0);
    v_prior_unchanged := coalesce((v_commit.summary->>'unchanged')::integer, 0);
  END IF;

  FOR v_row IN
    SELECT import_row.*
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
    ORDER BY import_row.row_number, import_row.id
    FOR UPDATE
  LOOP
    -- Defence in depth, and it RAISES (see 20260811170000).
    IF v_row.matched_profile_id IS NULL OR v_row.term_id IS NULL THEN
      RAISE EXCEPTION
        'Attendance row % is not reconciled to a member and semester.', v_row.id;
    END IF;
    IF v_row.matched_profile_id = ANY(v_committed_profiles) THEN
      RAISE EXCEPTION
        'Only one attendance record per member can be committed for this meeting.';
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
    v_match_metadata := v_row.normalized_data || v_row.resolution_metadata;

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
    ) SELECT
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
      -- Officer resolution metadata takes precedence over legacy match metadata.
      -- Source identity values remain in the immutable snapshot.
      CASE
        WHEN v_match_metadata->>'matchConfidence' ~ '^(0(\.\d+)?|1(\.0+)?)$'
          THEN (v_match_metadata->>'matchConfidence')::numeric
        WHEN nullif(v_row.normalized_data->>'normalizedEmail', '') IS NOT NULL THEN 1
        ELSE 0.9
      END,
      jsonb_build_object(
        'importJobId', v_preview.id,
        'importRowId', v_row.id,
        'rowNumber', v_row.row_number,
        'rowHash', v_row.row_hash,
        'correlationId', v_correlation_id,
        'reason', p_reason
      )
        || CASE
          WHEN jsonb_typeof(v_match_metadata->'matchDetails') = 'object'
            THEN v_match_metadata->'matchDetails'
          ELSE '{}'::jsonb
        END
        || CASE
          WHEN nullif(v_match_metadata->>'matchMethod', '') IS NOT NULL
            THEN jsonb_build_object('matchMethod', v_match_metadata->>'matchMethod')
          ELSE '{}'::jsonb
        END
    WHERE NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_meeting_attendance AS existing
      WHERE existing.profile_id = v_row.matched_profile_id
        AND existing.term_id = v_meeting.term_id
        AND existing.meeting_key = v_meeting.meeting_key
    )
    ON CONFLICT (profile_id, term_id, meeting_key) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
      -- Not a refusal: an attendance record that already exists is the officer correction
      -- this commit is required to preserve, so the row records that it was left alone.
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

  SELECT count(*)::integer
  INTO v_remaining_unresolved
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = v_preview.id
    AND import_row.import_status IN ('ambiguous', 'conflict', 'error');

  v_final_status := CASE
    WHEN v_failed > 0 OR v_unchanged > 0 OR v_remaining_unresolved > 0
      THEN 'partially_completed'
    ELSE 'completed'
  END;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET
    status = v_final_status,
    summary = jsonb_build_object(
      'previewJobId', v_preview.id,
      'created', v_prior_created + v_created,
      'unchanged', v_prior_unchanged + v_unchanged,
      'lastBatch', jsonb_build_object('created', v_created, 'unchanged', v_unchanged),
      'failed', v_failed,
      'remainingUnresolved', v_remaining_unresolved,
      'reason', p_reason
    ),
    committed_at = coalesce(v_commit.committed_at, v_now),
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
      WHEN v_remaining_unresolved > 0 THEN v_remaining_unresolved || ' row'
        || CASE WHEN v_remaining_unresolved = 1 THEN ' needs' ELSE 's need' END
        || ' officer review.'
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
      'remainingUnresolved', v_remaining_unresolved,
      'allowUnresolved', v_allow_unresolved,
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
    'remainingUnresolved', v_remaining_unresolved,
    'status', v_final_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid, uuid, uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid, uuid, uuid, text, uuid, uuid, boolean) TO postgres;

COMMIT;
