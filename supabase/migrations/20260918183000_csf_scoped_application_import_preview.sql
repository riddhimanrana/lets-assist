-- Queue one officer-resolved application response without approving its siblings.
-- The derived preview uses the ordinary fenced commit worker and retains both
-- the original source coordinate and the reviewed parent-row lineage.
BEGIN;

CREATE TABLE plugin_data.csf_scoped_application_imports (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_job_id uuid NOT NULL,
  parent_row_id uuid NOT NULL,
  scoped_job_id uuid NOT NULL,
  scoped_row_id uuid NOT NULL,
  request_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 4 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, parent_row_id),
  UNIQUE (organization_id, request_id),
  UNIQUE (organization_id, scoped_job_id),
  UNIQUE (organization_id, scoped_row_id),
  FOREIGN KEY (parent_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id),
  FOREIGN KEY (parent_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id),
  FOREIGN KEY (scoped_job_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_jobs (id, organization_id),
  FOREIGN KEY (scoped_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
);

ALTER TABLE plugin_data.csf_scoped_application_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_scoped_application_imports
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE plugin_data.csf_scoped_application_imports TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_scoped_application_import(
  p_organization_id uuid,
  p_parent_row_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_existing plugin_data.csf_scoped_application_imports%ROWTYPE;
  v_scoped_job_id uuid;
  v_scoped_row_id uuid;
  v_receipt jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
  v_row_count integer;
  v_parent_job_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_parent_row_id IS NULL
    OR p_actor_user_id IS NULL OR p_request_id IS NULL
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 4 AND 500
  THEN
    RAISE EXCEPTION 'Choose one application row and enter a reason of 4 to 500 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- Both a normal claim and another scoped request use the original preview's
  -- coordinate. This also orders the parent row before the source lock.
  SELECT import_row.job_id INTO v_parent_job_id
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_parent_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application preview row was not found.' USING ERRCODE = '23503';
  END IF;
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, v_parent_job_id
  );
  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id, v_parent_job_id, true
  );

  SELECT * INTO v_existing
  FROM plugin_data.csf_scoped_application_imports AS scoped
  WHERE scoped.organization_id = p_organization_id
    AND scoped.parent_row_id = p_parent_row_id;
  IF FOUND THEN
    IF v_existing.request_id IS DISTINCT FROM p_request_id
      OR v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.reason IS DISTINCT FROM v_reason
    THEN
      RAISE EXCEPTION 'This application row already has a scoped import. Reload its status.'
        USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'scopedJobId', v_existing.scoped_job_id,
      'scopedRowId', v_existing.scoped_row_id,
      'queued', true,
      'replayed', true
    );
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = v_parent_job_id;
  SELECT * INTO v_parent
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_parent_row_id
    AND import_row.job_id = v_job.id;

  IF v_parent.id IS NULL OR v_job.id IS NULL THEN
    RAISE EXCEPTION 'Application preview row was not found.' USING ERRCODE = '23503';
  END IF;

  IF v_job.mode <> 'preview' OR v_job.source_type <> 'application_responses'
    OR v_job.status NOT IN ('completed', 'needs_resolution')
    OR v_job.snapshot_contract_version IS DISTINCT FROM 'csf-normalized-import/v1'
    OR v_job.snapshot_row_count IS NULL
    OR v_job.snapshot_row_count < 1
    OR v_job.snapshot_hash IS NULL
    OR v_job.snapshot_hash !~ '^[0-9a-f]{64}$'
    OR v_job.source_content_hash IS NULL
    OR v_job.source_content_hash !~ '^[0-9a-f]{64}$'
    OR v_job.source_id IS NULL
    OR v_job.mapping_snapshot ? 'automaticUpdateAuthorizationId'
    OR v_parent.import_status <> 'pending'
    OR v_parent.resolution_status <> 'resolved'
    OR v_parent.matched_profile_id IS NULL
    OR v_parent.cohort_id IS NULL OR v_parent.term_id IS NULL
    OR v_parent.source_id IS DISTINCT FROM v_job.source_id
    OR v_parent.mapping_version IS DISTINCT FROM v_job.mapping_version
    OR v_parent.row_hash IS NULL
    OR v_parent.row_hash !~ '^[0-9a-f]{64}$'
    OR v_parent.commit_frozen_at IS NOT NULL
    OR v_parent.commit_outcome_state <> 'not_started'
    OR pg_catalog.jsonb_typeof(v_parent.normalized_data -> 'commitPayload') <> 'object'
    OR coalesce(pg_catalog.cardinality(v_parent.errors), 0) > 0
  THEN
    RAISE EXCEPTION 'This application row needs a fresh reviewed match before a scoped import.'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_row_count
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = v_job.id;
  IF v_row_count <> v_job.snapshot_row_count THEN
    RAISE EXCEPTION 'The original preview is incomplete. Run a fresh preview.'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_sheet_import_jobs AS commit_job
    WHERE commit_job.organization_id = p_organization_id
      AND commit_job.preview_job_id = v_job.id
      AND commit_job.mode = 'commit'
  ) OR EXISTS (
    SELECT 1 FROM plugin_data.csf_import_commit_queue AS queue
    WHERE queue.organization_id = p_organization_id
      AND queue.preview_job_id = v_job.id
      AND queue.status IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION 'This preview already has an import in progress. Reload it first.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM plugin_data.csf_assert_import_preview_workbook_generation_current(
    p_organization_id, v_job.id
  );
  PERFORM plugin_data.csf_assert_import_preview_mapping_current(
    p_organization_id, v_job.id
  );

  INSERT INTO plugin_data.csf_sheet_import_jobs (
    organization_id, source_id, initiated_by, mode, status, summary,
    started_at, completed_at, source_type, source_file_id, source_file_name,
    source_sheet_tab, source_range, source_modified_at, source_file_metadata,
    mapping_snapshot, mapping_version, retry_of_job_id, source_content_hash,
    snapshot_hash, snapshot_row_count, snapshot_contract_version
  ) VALUES (
    p_organization_id, v_job.source_id, p_actor_user_id, 'preview', 'completed',
    pg_catalog.jsonb_build_object(
      'scopedFromPreviewJobId', v_job.id,
      'scopedFromRowId', v_parent.id,
      'scope', 'one_officer_resolved_application_response'
    ),
    now(), now(), v_job.source_type, v_job.source_file_id,
    v_job.source_file_name, v_job.source_sheet_tab, v_job.source_range,
    v_job.source_modified_at, v_job.source_file_metadata,
    v_job.mapping_snapshot, v_job.mapping_version, v_job.id,
    v_job.source_content_hash,
    pg_catalog.encode(extensions.digest(
      'csf-scoped-application-row/v1:' || v_job.snapshot_hash || ':'
        || v_parent.id::text || ':' || v_parent.row_hash,
      'sha256'
    ), 'hex'),
    1, v_job.snapshot_contract_version
  ) RETURNING id INTO v_scoped_job_id;

  INSERT INTO plugin_data.csf_sheet_import_rows (
    organization_id, job_id, source_id, cohort_id, term_id, sheet_tab_name,
    row_number, source_range, raw_data, normalized_data, row_hash,
    matched_profile_id, matched_application_id, import_status, errors, warnings,
    mapping_version, resolution_status, resolution_reason_code,
    resolution_notes, resolved_by, resolved_at, retry_of_row_id,
    source_modified_at, resolution_metadata
  ) VALUES (
    p_organization_id, v_scoped_job_id, v_parent.source_id,
    v_parent.cohort_id, v_parent.term_id, v_parent.sheet_tab_name,
    v_parent.row_number, v_parent.source_range, v_parent.raw_data,
    v_parent.normalized_data, v_parent.row_hash, v_parent.matched_profile_id,
    v_parent.matched_application_id, 'pending', ARRAY[]::text[],
    v_parent.warnings, v_parent.mapping_version, 'resolved',
    v_parent.resolution_reason_code, v_parent.resolution_notes,
    v_parent.resolved_by, v_parent.resolved_at, v_parent.id,
    v_parent.source_modified_at, v_parent.resolution_metadata
  ) RETURNING id INTO v_scoped_row_id;

  UPDATE plugin_data.csf_sheet_import_rows
  SET import_status = 'superseded',
      resolution_status = 'superseded',
      resolution_reason_code = 'scoped_import'
  WHERE organization_id = p_organization_id AND id = v_parent.id;

  INSERT INTO plugin_data.csf_scoped_application_imports (
    organization_id, parent_job_id, parent_row_id, scoped_job_id,
    scoped_row_id, request_id, actor_user_id, reason
  ) VALUES (
    p_organization_id, v_job.id, v_parent.id, v_scoped_job_id,
    v_scoped_row_id, p_request_id, p_actor_user_id, v_reason
  );

  v_receipt := plugin_data.csf_queue_import_preview_batch(
    p_organization_id, p_actor_user_id, ARRAY[v_scoped_job_id]::uuid[],
    p_request_id
  );
  IF (v_receipt ->> 'queued')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'The scoped application import did not pass the source and approval checks.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    term_id, correlation_id, source_type, source_id, after_data
  ) VALUES (
    p_organization_id, p_actor_user_id, 'sheet_import.scoped_application_queued',
    'csf_sheet_import_rows', v_scoped_row_id, v_parent.term_id,
    v_parent.correlation_id, 'sheet_import', v_job.source_id::text,
    pg_catalog.jsonb_build_object(
      'parentPreviewJobId', v_job.id, 'parentRowId', v_parent.id,
      'scopedPreviewJobId', v_scoped_job_id, 'scopedRowId', v_scoped_row_id,
      'requestId', p_request_id, 'reason', v_reason,
      'rowHash', v_parent.row_hash
    )
  );

  RETURN pg_catalog.jsonb_build_object(
    'scopedJobId', v_scoped_job_id,
    'scopedRowId', v_scoped_row_id,
    'queued', true,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_queue_scoped_application_import(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_scoped_application_import(
  uuid, uuid, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_queue_scoped_application_import(
  uuid, uuid, uuid, uuid, text
) IS 'Derives and queues exactly one officer-resolved application row from a sealed source preview. The regular commit worker rechecks live source evidence and atomically applies only the derived row.';

COMMIT;
