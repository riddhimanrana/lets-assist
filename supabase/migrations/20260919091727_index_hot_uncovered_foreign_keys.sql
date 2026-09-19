-- Supabase's foreign-key advisor intentionally reports every foreign key that
-- lacks a complete non-partial leading index. Most current findings are on
-- small tables, empty optional relations, or columns already covered by a
-- purpose-built partial index. Add only the populated relationships on the
-- largest CSF import tables where a parent update/delete would otherwise scan
-- the child relation.

create index if not exists csf_sheet_import_rows_resolved_by_fk_idx
  on plugin_data.csf_sheet_import_rows (resolved_by);

create index if not exists csf_import_row_batch_outcomes_import_row_org_fk_idx
  on plugin_data.csf_import_row_batch_outcomes (import_row_id, organization_id);

create index if not exists csf_auto_import_approval_rows_import_row_org_fk_idx
  on plugin_data.csf_automatic_import_approval_rows (organization_id, import_row_id);
