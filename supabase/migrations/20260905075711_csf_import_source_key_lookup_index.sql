BEGIN;

-- Readiness checks compare each pending row with committed source lineage.
-- Index the same expression and status predicate used by both identity checks.
CREATE INDEX csf_import_rows_committed_source_key_idx
  ON plugin_data.csf_sheet_import_rows (
    organization_id,
    cohort_id,
    plugin_data.csf_class_history_source_key_value(normalized_data)
  )
  WHERE import_status IN ('created', 'updated');

COMMENT ON INDEX plugin_data.csf_import_rows_committed_source_key_idx IS
  'Bounds historical source-key lookups for workbook readiness and atomic identity reuse. Does not change matching, conflict, or authorization rules.';

COMMIT;
