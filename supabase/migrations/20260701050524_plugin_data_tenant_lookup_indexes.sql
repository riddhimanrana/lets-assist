-- Ensure plugin tenant lookups have a leading organization_id index.
--
-- These tables already carry organization_id FKs. The indexes below support
-- RLS membership checks, staff/admin dashboards, and future enterprise data
-- movement by tenant without adding broad blanket indexes.

CREATE INDEX IF NOT EXISTS idx_dv_sd_allocation_drafts_org
  ON plugin_data.dv_sd_allocation_drafts (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_guardian_action_tokens_org
  ON plugin_data.dv_sd_guardian_action_tokens (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assignments_v2_org
  ON plugin_data.dv_sd_judge_assignments_v2 (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_availability_org
  ON plugin_data.dv_sd_judge_availability (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_conflicts_org
  ON plugin_data.dv_sd_judge_conflicts (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_meeting_attendance_org
  ON plugin_data.dv_sd_meeting_attendance (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_tabroom_links_org
  ON plugin_data.dv_sd_tabroom_links (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_tabroom_sync_runs_org
  ON plugin_data.dv_sd_tabroom_sync_runs (organization_id);

CREATE INDEX IF NOT EXISTS idx_dv_sd_tournament_registrations_org
  ON plugin_data.dv_sd_tournament_registrations (organization_id);
