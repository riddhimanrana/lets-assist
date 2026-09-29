-- The import retry service reads frozen receipts before preparing a new preview.
-- Approval creation and changes remain restricted to the existing transactions.
BEGIN;
GRANT SELECT ON plugin_data.csf_automatic_import_approvals,
  plugin_data.csf_automatic_import_approval_rows TO service_role;
COMMIT;
