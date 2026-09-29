BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);
SELECT extensions.has_index('plugin_data', 'csf_sheet_import_rows', 'csf_sheet_import_rows_closure_evidence_idx', 'semester evidence has an organization-scoped read index');
SELECT extensions.is((SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid='plugin_data.csf_sheet_import_rows_closure_evidence_idx'::regclass), 'CREATE INDEX csf_sheet_import_rows_closure_evidence_idx ON plugin_data.csf_sheet_import_rows USING btree (organization_id, term_id, id) INCLUDE (job_id, import_status, resolution_status, resolved_at, created_at)', 'index covers exactly the source fields consumed by the existing evidence hash');
SELECT extensions.ok((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid='plugin_data.csf_sheet_import_rows_closure_evidence_idx'::regclass), 'the evidence index is valid and ready');
SELECT extensions.ok((SELECT NOT indisunique AND indpred IS NULL FROM pg_index WHERE indexrelid='plugin_data.csf_sheet_import_rows_closure_evidence_idx'::regclass), 'all response states remain included without a new uniqueness rule');
SELECT * FROM extensions.finish();
ROLLBACK;
