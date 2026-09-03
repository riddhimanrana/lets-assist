-- Remove default-schema table privileges that exceeded the reviewed worker ACLs.

BEGIN;

REVOKE ALL ON TABLE
  plugin_data.csf_class_workbooks,
  plugin_data.csf_class_workbook_refresh_jobs,
  plugin_data.csf_import_approval_batches,
  plugin_data.csf_import_commit_queue,
  plugin_data.csf_import_approval_batch_items,
  plugin_data.csf_import_row_batches,
  plugin_data.csf_import_row_batch_outcomes
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  plugin_data.csf_class_workbooks,
  plugin_data.csf_class_workbook_refresh_jobs,
  plugin_data.csf_import_commit_queue
TO service_role;

COMMIT;
