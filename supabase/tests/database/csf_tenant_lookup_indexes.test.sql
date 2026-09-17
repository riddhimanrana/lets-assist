BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(3);
SELECT has_index('plugin_data', 'csf_application_decision_sync_sources',
  'csf_decision_sync_sources_org_run_idx', ARRAY['organization_id','run_id'],
  'Decision source reads have organization and run index coverage');
SELECT has_index('plugin_data', 'csf_retention_preview_profiles',
  'csf_retention_preview_profiles_org_run_idx', ARRAY['organization_id','run_id'],
  'Retention previews have organization and run index coverage');
SELECT has_index('plugin_data', 'csf_sheet_semester_ledger_writes',
  'csf_semester_ledger_writes_org_profile_status_idx', ARRAY['organization_id','profile_id','status'],
  'Semester write ownership checks have organization and profile index coverage');
SELECT * FROM finish();
ROLLBACK;
