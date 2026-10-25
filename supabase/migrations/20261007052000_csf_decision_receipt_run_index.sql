BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Receipt reads must bound their work by tenant and run as evidence accumulates.
CREATE INDEX csf_application_decision_sync_rows_org_run_idx
  ON plugin_data.csf_application_decision_sync_rows
    (organization_id, run_id, observed_row_number);

CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_application_decision_run_receipt(
  p_organization_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'runId', run.id,
    'termId', run.term_id,
    'status', run.status,
    'createdAt', run.created_at,
    'error', run.error_text,
    'counts', pg_catalog.jsonb_build_object(
      'changed', run.changed_count,
      'unchanged', run.unchanged_count,
      'unmatched', run.unmatched_count,
      'conflict', run.conflict_count,
      'appliedToReleased', run.applied_count,
      'retractedFromRelease', run.retracted_count
    ),
    'sources', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'sourceId', source.source_id,
        'readStatus', source.read_status,
        'message', source.message,
        'spreadsheetFileId', source.spreadsheet_file_id,
        'spreadsheetTitle', source.spreadsheet_title,
        'providerVersion', source.provider_version,
        'sheetTabName', source.sheet_tab_name,
        'sheetTabId', source.sheet_tab_id,
        'requestedRange', source.requested_range,
        'contentHash', source.content_hash,
        'mappingVersion', source.mapping_version
      ) ORDER BY source.sheet_tab_name)
      FROM plugin_data.csf_application_decision_sync_sources AS source
      WHERE source.organization_id = run.organization_id
        AND source.run_id = run.id
    ), '[]'::jsonb),
    'rows', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'observedRowNumber', evidence_row.observed_row_number,
        'applicationId', evidence_row.application_id,
        'matchBasis', evidence_row.match_basis,
        'outcome', evidence_row.outcome,
        'decision', evidence_row.decision,
        'blockReason', evidence_row.block_reason,
        'appliedToReleased', evidence_row.applied_to_released,
        'retractedRelease', evidence_row.retracted_release
      ) ORDER BY evidence_row.observed_row_number)
      FROM plugin_data.csf_application_decision_sync_rows AS evidence_row
      WHERE evidence_row.organization_id = run.organization_id
        AND evidence_row.run_id = run.id
    ), '[]'::jsonb)
  )
  FROM plugin_data.csf_application_decision_sync_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.id = p_run_id;
$$;
REVOKE ALL ON FUNCTION plugin_data.csf_sheet_application_decision_run_receipt(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_application_decision_run_receipt(uuid,uuid)
  TO postgres;

COMMIT;
