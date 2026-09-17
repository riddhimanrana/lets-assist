-- These tenant-owned tables had only receipt/id-leading indexes. Organization
-- reads and identity lifecycle checks need an organization-leading path too.
CREATE INDEX csf_decision_sync_sources_org_run_idx
  ON plugin_data.csf_application_decision_sync_sources (organization_id, run_id);
CREATE INDEX csf_retention_preview_profiles_org_run_idx
  ON plugin_data.csf_retention_preview_profiles (organization_id, run_id);
CREATE INDEX csf_semester_ledger_writes_org_profile_status_idx
  ON plugin_data.csf_sheet_semester_ledger_writes (organization_id, profile_id, status);
