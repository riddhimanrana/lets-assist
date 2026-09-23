-- Retain audited history exclusions only within a locked, unchanged workbook generation.
BEGIN;

CREATE FUNCTION plugin_data.csf_carry_forward_history_exclusion(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_current_row_id uuid,
  p_previous_row_id uuid,
  p_previous_audit_id uuid,
  p_expected_current_state jsonb,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_previous plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_current_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_previous_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_audit plugin_data.csf_admin_audit_events%ROWTYPE;
  v_key text;
  v_reason text;
  v_metadata jsonb;
  v_result jsonb;
  v_receipt uuid;
BEGIN
  IF p_current_row_id IS NULL OR p_previous_row_id IS NULL
    OR p_current_row_id = p_previous_row_id OR p_previous_audit_id IS NULL
    OR jsonb_typeof(p_expected_current_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The exclusion carry-forward request is incomplete.' USING ERRCODE='22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT * INTO v_current FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_current_row_id;
  SELECT * INTO v_previous FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_previous_row_id;
  IF v_current.id IS NULL OR v_previous.id IS NULL OR v_current.job_id=v_previous.job_id THEN
    RAISE EXCEPTION 'The exclusion rows do not belong to separate chapter previews.' USING ERRCODE='42501';
  END IF;

  -- Match review lock order: preview jobs, then their rows.
  PERFORM j.id FROM plugin_data.csf_sheet_import_jobs j
    WHERE j.organization_id=p_organization_id AND j.id IN(v_current.job_id,v_previous.job_id)
    ORDER BY j.id FOR UPDATE;
  PERFORM r.id FROM plugin_data.csf_sheet_import_rows r
    WHERE r.organization_id=p_organization_id AND r.id IN(p_current_row_id,p_previous_row_id)
    ORDER BY r.id FOR UPDATE;
  SELECT * INTO STRICT v_current FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_current_row_id;
  SELECT * INTO STRICT v_previous FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id=p_organization_id AND id=p_previous_row_id;
  SELECT * INTO STRICT v_current_job FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=v_current.job_id;
  SELECT * INTO STRICT v_previous_job FROM plugin_data.csf_sheet_import_jobs
    WHERE organization_id=p_organization_id AND id=v_previous.job_id;

  -- Follow import commit lock order: staff, identity, preview rows, workbook, then source.
  PERFORM plugin_data.csf_heartbeat_class_workbook_refresh_generation(
    p_organization_id,p_actor_user_id,p_refresh_job_id,p_refresh_lease_token,
    p_workbook_id,p_cohort_id,p_drive_file_id,p_provider_version,300
  );

  IF v_current_job.mode<>'preview' OR v_previous_job.mode<>'preview'
    OR v_current_job.status NOT IN('completed','needs_resolution')
    OR v_previous_job.status NOT IN('completed','needs_resolution')
    OR v_current_job.source_type IS DISTINCT FROM 'class_history'
    OR v_previous_job.source_type IS DISTINCT FROM 'class_history'
    OR v_current_job.source_id IS NULL
    OR v_current_job.source_id IS DISTINCT FROM v_previous_job.source_id
    OR v_current_job.source_file_id IS DISTINCT FROM p_drive_file_id
    OR v_current_job.source_file_id IS DISTINCT FROM v_previous_job.source_file_id
    OR v_current_job.source_sheet_tab IS NULL
    OR v_current_job.source_sheet_tab IS DISTINCT FROM v_previous_job.source_sheet_tab
    OR v_current_job.source_range IS NULL
    OR v_current_job.source_range IS DISTINCT FROM v_previous_job.source_range
    OR v_current_job.mapping_version IS DISTINCT FROM v_previous_job.mapping_version
    OR v_current_job.snapshot_contract_version IS NULL
    OR v_current_job.snapshot_contract_version IS DISTINCT FROM v_previous_job.snapshot_contract_version
    OR v_previous_job.created_at>=v_current_job.created_at
    OR v_current_job.mapping_snapshot->>'workbookId' IS DISTINCT FROM p_workbook_id::text
    OR v_current_job.mapping_snapshot->>'workbookRefreshJobId' IS DISTINCT FROM p_refresh_job_id::text
    OR v_current_job.mapping_snapshot->>'workbookDriveFileId' IS DISTINCT FROM p_drive_file_id
    OR v_current_job.mapping_snapshot->>'workbookProviderVersion' IS DISTINCT FROM p_provider_version
  THEN RAISE EXCEPTION 'The exclusion preview scope changed.' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_source FROM plugin_data.csf_sheet_sources
    WHERE organization_id=p_organization_id AND id=v_current_job.source_id FOR SHARE;
  IF v_source.id IS NULL OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_source.provider<>'google_sheets' OR v_source.sync_mode='disabled'
    OR v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.spreadsheet_id IS DISTINCT FROM p_drive_file_id
    OR v_source.settings->>'mappingVersion' IS DISTINCT FROM v_current_job.mapping_version::text
    OR EXISTS(SELECT 1 FROM plugin_data.csf_sheet_import_jobs j
      WHERE j.organization_id=p_organization_id AND j.source_id=v_source.id AND j.mode='preview'
        AND j.created_at>v_previous_job.created_at AND j.id<>v_current_job.id)
  THEN RAISE EXCEPTION 'The exclusion source or latest preview changed.' USING ERRCODE='55000'; END IF;

  IF nullif(v_current_job.mapping_snapshot#>>'{normalizedSnapshot,targetSignature}','') IS NULL
    OR v_current_job.mapping_snapshot#>'{normalizedSnapshot,targetSignature}' IS DISTINCT FROM
      v_previous_job.mapping_snapshot#>'{normalizedSnapshot,targetSignature}'
  THEN RAISE EXCEPTION 'The exclusion target mapping changed.' USING ERRCODE='55000'; END IF;
  FOREACH v_key IN ARRAY ARRAY['version','sourceType','tabs','columns','duplicatePolicy','headerSignature',
    'resolvedColumns','rejectedColumns','notMappedFields'] LOOP
    IF v_current_job.mapping_snapshot->v_key IS DISTINCT FROM v_previous_job.mapping_snapshot->v_key THEN
      RAISE EXCEPTION 'The exclusion mapping evidence changed.' USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['unmatchedWorkbookThreadedComments','unmatchedWorkbookThreadedCommentCount','diagnostics'] LOOP
    IF v_current_job.mapping_snapshot#>ARRAY['normalizedSnapshot',v_key] IS DISTINCT FROM
      v_previous_job.mapping_snapshot#>ARRAY['normalizedSnapshot',v_key] THEN
      RAISE EXCEPTION 'The exclusion workbook evidence changed.' USING ERRCODE='55000';
    END IF;
  END LOOP;

  IF v_previous.import_status<>'skipped' OR v_previous.resolution_status<>'ignored'
    OR v_previous.resolution_reason_code IS DISTINCT FROM 'officer_skipped'
    OR v_previous.resolved_by IS NULL OR v_previous.resolved_at IS NULL
    OR nullif(v_previous.resolution_notes,'') IS NULL
    OR v_current.source_id IS DISTINCT FROM v_source.id OR v_previous.source_id IS DISTINCT FROM v_source.id
    OR v_current.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_current.cohort_id IS DISTINCT FROM v_previous.cohort_id
    OR v_current.term_id IS NULL OR v_current.term_id IS DISTINCT FROM v_previous.term_id
    OR v_current.sheet_tab_name IS DISTINCT FROM v_previous.sheet_tab_name
    OR v_current.source_range IS NULL OR v_current.source_range IS DISTINCT FROM v_previous.source_range
    OR v_current.row_number IS DISTINCT FROM v_previous.row_number
    OR v_current.row_hash IS NULL OR v_current.row_hash IS DISTINCT FROM v_previous.row_hash
    OR v_current.normalized_data->>'rowHash' IS DISTINCT FROM v_current.row_hash
    OR v_previous.normalized_data->>'rowHash' IS DISTINCT FROM v_previous.row_hash
    OR v_current.raw_data IS DISTINCT FROM v_previous.raw_data
    OR (v_current.normalized_data-'snapshotHash'-'matchBasis') IS DISTINCT FROM
      (v_previous.normalized_data-'snapshotHash'-'matchBasis')
    OR v_current.commit_outcome_state IS DISTINCT FROM 'not_started'
    OR v_previous.commit_outcome_state IS DISTINCT FROM 'not_started'
    OR v_current.commit_attempt_id IS NOT NULL OR v_previous.commit_attempt_id IS NOT NULL
    OR v_current.commit_intent_attempt_id IS NOT NULL OR v_previous.commit_intent_attempt_id IS NOT NULL
    OR v_current.commit_frozen_at IS NOT NULL OR v_previous.commit_frozen_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM plugin_data.csf_import_commit_queue q WHERE q.organization_id=p_organization_id
      AND q.preview_job_id IN(v_current.job_id,v_previous.job_id) AND q.status IN('queued','running'))
  THEN RAISE EXCEPTION 'The exclusion row evidence or commit state changed.' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_audit FROM plugin_data.csf_admin_audit_events a
    WHERE a.organization_id=p_organization_id AND a.id=p_previous_audit_id
      AND a.target_type='csf_sheet_import_rows' AND a.target_id=v_previous.id
      AND a.action='sheets.row_skipped' AND a.actor_user_id=v_previous.resolved_by
      AND a.correlation_id IS NOT DISTINCT FROM v_previous.correlation_id
      AND a.after_data->>'jobId'=v_previous.job_id::text
      AND a.after_data->>'sourceId'=v_previous.source_id::text
      AND a.after_data->>'decision'='skip' AND a.after_data->>'reason'=v_previous.resolution_notes;
  IF v_audit.id IS NULL THEN
    RAISE EXCEPTION 'The previous officer exclusion receipt is missing.' USING ERRCODE='55000';
  END IF;
  v_reason:=left(format('Retain unchanged exclusion from preview %s, row %s, audit %s. Original review: %s',
    v_previous.job_id,v_previous.id,v_audit.id,v_previous.resolution_notes),500);
  v_metadata:=jsonb_build_object('kind','history_exclusion_carry_forward','previousJobId',v_previous.job_id,
    'previousRowId',v_previous.id,'previousAuditId',v_audit.id,'rowHash',v_current.row_hash,
    'refreshJobId',p_refresh_job_id,'providerVersion',p_provider_version);

  IF v_current.import_status='skipped' AND v_current.resolution_status='ignored' THEN
    SELECT a.id INTO v_receipt FROM plugin_data.csf_admin_audit_events a
      WHERE a.organization_id=p_organization_id AND a.target_id=v_current.id AND a.action='sheets.row_skipped'
        AND a.after_data->'matchMetadata'=v_metadata AND a.after_data->>'reason'=v_reason
      ORDER BY a.created_at LIMIT 1;
    IF v_receipt IS NOT NULL AND v_current.resolution_notes=v_reason THEN
      RETURN jsonb_build_object('rowId',v_current.id,'decision','skip','idempotent',true,'auditId',v_receipt);
    END IF;
    RAISE EXCEPTION 'A newer officer exclusion already exists.' USING ERRCODE='55000';
  END IF;
  IF v_current.resolution_status<>'pending' OR v_current.resolved_by IS NOT NULL OR v_current.resolved_at IS NOT NULL
    OR v_current.resolution_reason_code IS NOT NULL
    OR v_current.import_status NOT IN('pending','ambiguous','conflict','duplicate','error')
    OR p_expected_current_state IS DISTINCT FROM jsonb_build_object('importStatus',v_current.import_status,
      'resolutionStatus',v_current.resolution_status,'matchedProfileId',v_current.matched_profile_id,'rowHash',v_current.row_hash)
  THEN RAISE EXCEPTION 'A newer officer review changed this row.' USING ERRCODE='55000'; END IF;

  v_result:=plugin_data.csf_reconcile_sheet_import_row(p_organization_id,v_current.id,NULL,'skip',v_reason,
    p_actor_user_id,v_current.correlation_id,v_metadata);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_carry_forward_history_exclusion(uuid,uuid,uuid,uuid,uuid,jsonb,uuid,uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_carry_forward_history_exclusion(uuid,uuid,uuid,uuid,uuid,jsonb,uuid,uuid,uuid,uuid,text,text)
  TO service_role;

COMMIT;
