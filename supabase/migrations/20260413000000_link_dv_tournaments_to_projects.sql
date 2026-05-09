-- Add project_id to dv_sd_tournaments to link with core platform projects
ALTER TABLE plugin_data.dv_sd_tournaments 
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dv_sd_tournaments_project ON plugin_data.dv_sd_tournaments(project_id);
