BEGIN;

-- Lock the preview before its row so preparation cannot race a review.
DO $identity_preview_state$
DECLARE
  v_definition text;
  v_body_hash text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid), pg_catalog.md5(p.prosrc)
  INTO v_definition, v_body_hash
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)'::regprocedure;
  IF v_body_hash IS DISTINCT FROM '1a753bdc4474fb1f5fcbb93f4d56d4d1' THEN
    RAISE EXCEPTION 'Unexpected identity review predecessor.';
  END IF;
  v_definition := pg_catalog.replace(v_definition,
    '  v_annotation_only_error boolean;',
    '  v_annotation_only_error boolean;
  v_job plugin_data.csf_sheet_import_jobs%ROWTYPE;');
  v_definition := pg_catalog.replace(v_definition,
    '  SELECT import_row.*
  INTO v_row',
    '  SELECT job.* INTO v_job
  FROM plugin_data.csf_sheet_import_jobs AS job
  JOIN plugin_data.csf_sheet_import_rows AS source_row
    ON source_row.organization_id = job.organization_id AND source_row.job_id = job.id
  WHERE source_row.organization_id = p_organization_id AND source_row.id = p_row_id
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION ''Import row not found.'';
  END IF;
  IF v_job.mode <> ''preview'' OR v_job.status NOT IN (''completed'', ''needs_resolution'') THEN
    RAISE EXCEPTION ''Choose a completed preview before reviewing identity.'';
  END IF;

  SELECT import_row.*
  INTO v_row');
  v_definition := pg_catalog.replace(v_definition,
    '  v_annotation_only_error :=',
    '  IF v_row.job_id IS DISTINCT FROM v_job.id THEN
    RAISE EXCEPTION ''The import row preview changed. Reload before reviewing identity.'';
  END IF;

  v_annotation_only_error :=');
  EXECUTE v_definition;
END;
$identity_preview_state$;

REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)
  TO postgres;

COMMIT;
