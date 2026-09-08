-- Preserve failed import receipts while officers stop untouched queues and prepare a new review.
BEGIN;

CREATE FUNCTION plugin_data.csf_request_class_workbook_import_recovery(
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
  v_queue plugin_data.csf_import_commit_queue%ROWTYPE;
  v_stopped uuid[] := ARRAY[]::uuid[];
  v_fingerprint text;
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL OR p_cohort_id IS NULL
    OR nullif(pg_catalog.btrim(p_expected_drive_file_id), '') IS NULL THEN
    RAISE EXCEPTION 'A class, workbook identity, and request identifier are required.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id, p_actor_user_id, 'class_history');
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM member.user_id FROM public.organization_members member
    WHERE member.organization_id = p_organization_id AND member.user_id = p_actor_user_id FOR SHARE;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id, p_actor_user_id, 'class_history');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_class_workbook:' || p_organization_id::text || ':' || p_cohort_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'csf_workbook_reprepare:' || p_organization_id::text || ':' || p_request_id::text, 0));

  v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_array(
    p_organization_id, p_cohort_id, p_actor_user_id, p_expected_drive_file_id)::text, 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = p_organization_id AND correlation_id = p_request_id
      AND action = 'sheets.class_workbook_import_recovery_requested';
  IF FOUND THEN
    IF v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request identifier belongs to a different workbook request.' USING ERRCODE = '22023';
    END IF;
    RETURN (v_receipt.after_data -> 'result') || '{"replayed":true}'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = p_organization_id AND correlation_id = p_request_id
      AND action = 'sheets.class_workbook_reprepare_requested') THEN
    RAISE EXCEPTION 'Use a new request identifier for import recovery.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_workbook FROM plugin_data.csf_class_workbooks
    WHERE organization_id = p_organization_id AND cohort_id = p_cohort_id FOR UPDATE;
  IF NOT FOUND OR v_workbook.state <> 'linked'
    OR v_workbook.drive_file_id IS DISTINCT FROM p_expected_drive_file_id
    OR v_workbook.provider_version IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_changed_or_unavailable');
  END IF;
  PERFORM plugin_data.csf_assert_import_actor(p_organization_id, v_workbook.drive_owner_user_id, 'class_history');

  IF EXISTS (SELECT 1 FROM plugin_data.csf_class_workbook_refresh_jobs
    WHERE organization_id = p_organization_id AND workbook_id = v_workbook.id AND status = 'running') THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_processing');
  END IF;

  -- Do not wait behind a worker that may hold the queue before its authority lock.
  BEGIN
    FOR v_queue IN
      SELECT queue.* FROM plugin_data.csf_import_commit_queue queue
      JOIN plugin_data.csf_sheet_import_jobs preview
        ON preview.id = queue.preview_job_id AND preview.organization_id = queue.organization_id
      JOIN plugin_data.csf_sheet_sources source
        ON source.id = preview.source_id AND source.organization_id = preview.organization_id
      WHERE queue.organization_id = p_organization_id AND source.cohort_id = p_cohort_id
        AND preview.source_file_id = p_expected_drive_file_id
        AND queue.status IN ('queued', 'running')
      ORDER BY queue.id FOR UPDATE OF queue NOWAIT
    LOOP
      IF v_queue.status <> 'queued' OR v_queue.attempt_count <> 0
        OR v_queue.started_at IS NOT NULL OR v_queue.lease_token IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_processing');
      END IF;
      v_stopped := pg_catalog.array_append(v_stopped, v_queue.id);
    END LOOP;
  EXCEPTION WHEN lock_not_available THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'workbook_processing');
  END;

  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_rows row
    JOIN plugin_data.csf_sheet_import_jobs preview ON preview.id = row.job_id AND preview.organization_id = row.organization_id
    JOIN plugin_data.csf_sheet_sources source ON source.id = preview.source_id AND source.organization_id = preview.organization_id
    WHERE row.organization_id = p_organization_id AND source.cohort_id = p_cohort_id
      AND preview.source_file_id = p_expected_drive_file_id
      AND row.commit_outcome_state IN ('in_flight', 'unknown', 'historical_unknown')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked', 'reasonCode', 'import_outcome_unresolved');
  END IF;

  UPDATE plugin_data.csf_import_commit_queue
    SET status = 'blocked', error_code = 'officer_review_requested', finished_at = pg_catalog.now(), updated_at = pg_catalog.now()
    WHERE organization_id = p_organization_id AND id = ANY(v_stopped);
  v_result := plugin_data.csf_request_class_workbook_reprepare(
    p_organization_id, p_cohort_id, p_actor_user_id, p_request_id, p_expected_drive_file_id);
  IF v_result ->> 'status' IS DISTINCT FROM 'queued' THEN
    -- Roll back queue changes together if a new review cannot be prepared.
    RAISE EXCEPTION 'Workbook recovery could not queue a new review.' USING ERRCODE = '55000';
  END IF;
  v_result := v_result || pg_catalog.jsonb_build_object('stoppedCount', pg_catalog.cardinality(v_stopped));
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, after_data,
    source_type, source_id, reason_code, correlation_id
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheets.class_workbook_import_recovery_requested',
    'csf_class_workbooks', v_workbook.id,
    pg_catalog.jsonb_build_object('requestFingerprint', v_fingerprint, 'stoppedQueueIds', v_stopped, 'result', v_result),
    'class_history', p_cohort_id::text, 'officer_review_requested', p_request_id
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)
  IS 'Audited officer recovery: stop only untouched queued imports, retain every source and outcome receipt, and request a fresh workbook review. Running and unknown outcomes refuse recovery.';

COMMIT;
