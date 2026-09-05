-- Hold staff authority through receipt replay and workbook queue mutation.

CREATE OR REPLACE FUNCTION plugin_data.csf_request_class_workbook_reprepare(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_drive_file_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_fingerprint text;
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL OR p_cohort_id IS NULL
    OR p_expected_drive_file_id IS NULL
    OR pg_catalog.btrim(p_expected_drive_file_id) = '' THEN
    RAISE EXCEPTION 'A class, workbook identity, and request identifier are required.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'class_history'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  PERFORM member.user_id FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
  FOR SHARE;
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'class_history'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_class_workbook:' || p_organization_id::text || ':' || p_cohort_id::text, 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'csf_workbook_reprepare:' || p_organization_id::text || ':' || p_request_id::text, 0
  ));
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'class_history'
  );
  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_array(p_organization_id, p_cohort_id, p_actor_user_id,
      p_expected_drive_file_id)::text, 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
  WHERE organization_id = p_organization_id AND correlation_id = p_request_id
    AND action = 'sheets.class_workbook_reprepare_requested';
  IF FOUND THEN
    IF v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request identifier belongs to a different workbook request.'
        USING ERRCODE = '22023';
    END IF;
    RETURN (v_receipt.after_data -> 'result') || '{"replayed":true}'::jsonb;
  END IF;

  SELECT * INTO v_workbook FROM plugin_data.csf_class_workbooks
  WHERE organization_id = p_organization_id AND cohort_id = p_cohort_id
  FOR UPDATE;
  IF NOT FOUND OR v_workbook.state <> 'linked'
    OR v_workbook.drive_file_id IS DISTINCT FROM p_expected_drive_file_id
    OR v_workbook.provider_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_changed_or_unavailable');
  END IF;
  PERFORM member.user_id FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = v_workbook.drive_owner_user_id
  FOR SHARE;
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, v_workbook.drive_owner_user_id, 'class_history'
  );
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_class_workbook_refresh_jobs AS job
    WHERE job.workbook_id = v_workbook.id AND job.status = 'running'
  ) OR EXISTS (
    SELECT 1 FROM plugin_data.csf_import_commit_queue AS queue
    JOIN plugin_data.csf_sheet_import_jobs AS preview ON preview.id = queue.preview_job_id
      AND preview.organization_id = queue.organization_id
    JOIN plugin_data.csf_sheet_sources AS source ON source.id = preview.source_id
      AND source.organization_id = preview.organization_id
    WHERE queue.organization_id = p_organization_id AND source.cohort_id = p_cohort_id
      AND queue.status IN ('queued', 'running')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_processing');
  END IF;

  UPDATE plugin_data.csf_class_workbooks SET last_prepared_version = NULL
  WHERE id = v_workbook.id AND organization_id = p_organization_id;
  v_result := plugin_data.csf_queue_class_workbook_preparation(
    p_organization_id, p_cohort_id, v_workbook.drive_file_id,
    v_workbook.drive_owner_user_id, v_workbook.provider_version,
    v_workbook.provider_modified_at::text, v_workbook.discovered_tabs
  );
  IF v_result ->> 'status' IS DISTINCT FROM 'queued' OR v_result ->> 'jobId' IS NULL THEN
    RAISE EXCEPTION 'Workbook preparation did not return a queued receipt.';
  END IF;
  UPDATE plugin_data.csf_class_workbook_refresh_jobs
  SET requested_by = p_actor_user_id
  WHERE id = (v_result ->> 'jobId')::uuid AND organization_id = p_organization_id
    AND status = 'queued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workbook preparation was not queued for this officer.';
  END IF;
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, source_type, source_id, reason_code, correlation_id
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheets.class_workbook_reprepare_requested',
    'csf_class_workbooks', v_workbook.id,
    pg_catalog.jsonb_build_object('providerVersion', v_workbook.provider_version,
      'lastPreparedVersion', v_workbook.last_prepared_version),
    pg_catalog.jsonb_build_object('requestFingerprint', v_fingerprint, 'result', v_result),
    'class_history', p_cohort_id::text, 'officer_reprepare', p_request_id
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_request_class_workbook_reprepare(uuid, uuid, uuid, uuid, text)
  IS 'Officer-requested, retry-safe preparation of the linked workbook. Retains source snapshots and never commits rows or changes approvals.';
REVOKE ALL ON FUNCTION plugin_data.csf_request_class_workbook_reprepare(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_request_class_workbook_reprepare(uuid, uuid, uuid, uuid, text)
  TO service_role;
