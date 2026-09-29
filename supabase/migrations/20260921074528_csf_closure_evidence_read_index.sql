-- Read the semester evidence hash without fetching each full import snapshot.
BEGIN;
CREATE INDEX csf_sheet_import_rows_closure_evidence_idx
  ON plugin_data.csf_sheet_import_rows (organization_id, term_id, id)
  INCLUDE (job_id, import_status, resolution_status, resolved_at, created_at);
COMMIT;
