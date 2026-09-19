BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

SELECT extensions.has_index(
  'plugin_data',
  'csf_sheet_import_rows',
  'csf_sheet_import_rows_resolved_by_fk_idx',
  'import-row resolver maintenance has a covering foreign-key index'
);

SELECT extensions.is(
  pg_get_indexdef(
    'plugin_data.csf_sheet_import_rows_resolved_by_fk_idx'::regclass
  ),
  'CREATE INDEX csf_sheet_import_rows_resolved_by_fk_idx ON plugin_data.csf_sheet_import_rows USING btree (resolved_by)',
  'the resolver index leads with the foreign-key column'
);

SELECT extensions.has_index(
  'plugin_data',
  'csf_import_row_batch_outcomes',
  'csf_import_row_batch_outcomes_import_row_org_fk_idx',
  'batch outcome cleanup has a covering import-row tenant index'
);

SELECT extensions.is(
  pg_get_indexdef(
    'plugin_data.csf_import_row_batch_outcomes_import_row_org_fk_idx'::regclass
  ),
  'CREATE INDEX csf_import_row_batch_outcomes_import_row_org_fk_idx ON plugin_data.csf_import_row_batch_outcomes USING btree (import_row_id, organization_id)',
  'the batch outcome index covers the complete composite foreign key'
);

SELECT extensions.has_index(
  'plugin_data',
  'csf_automatic_import_approval_rows',
  'csf_auto_import_approval_rows_import_row_org_fk_idx',
  'automatic approval maintenance has a covering import-row tenant index'
);

SELECT extensions.is(
  pg_get_indexdef(
    'plugin_data.csf_auto_import_approval_rows_import_row_org_fk_idx'::regclass
  ),
  'CREATE INDEX csf_auto_import_approval_rows_import_row_org_fk_idx ON plugin_data.csf_automatic_import_approval_rows USING btree (organization_id, import_row_id)',
  'the automatic approval index covers the complete composite foreign key'
);

SELECT * FROM extensions.finish();
ROLLBACK;
