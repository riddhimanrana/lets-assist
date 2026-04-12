-- Migration: Plugin versions table + DVSD enhancements

-- ============================================================
-- 1. Plugin Versions (public schema — part of the catalog)
-- ============================================================

CREATE TABLE public.plugin_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_key text NOT NULL REFERENCES public.plugins(key) ON DELETE CASCADE,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'published', 'rejected')),
  changelog text,
  commit_sha text,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  review_notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (plugin_key, version)
);

CREATE INDEX idx_plugin_versions_key ON public.plugin_versions(plugin_key);
CREATE INDEX idx_plugin_versions_status ON public.plugin_versions(plugin_key, status);

COMMENT ON TABLE public.plugin_versions IS 'Tracks all versions of a plugin. Status workflow: draft → review → published/rejected.';

-- RLS: Platform admins can manage, everyone can read published
ALTER TABLE public.plugin_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plugin_versions_read" ON public.plugin_versions
  FOR SELECT USING (true);  -- Published versions are public knowledge

-- ============================================================
-- 2. DVSD Tabroom Links (plugin_data)
-- ============================================================

CREATE TABLE plugin_data.dv_sd_tabroom_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL,  -- FK to dv_sd_tournaments once moved
  tabroom_url text NOT NULL,
  tabroom_tournament_id text,   -- Extracted numeric ID from URL
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_dv_sd_tabroom_tournament ON plugin_data.dv_sd_tabroom_links(tournament_id);

COMMENT ON TABLE plugin_data.dv_sd_tabroom_links IS 'User-provided Tabroom.com links associated with DVSD tournaments. Experimental — link-only, no scraping.';

-- ============================================================
-- 3. DVSD Google Sheets Sync Config (plugin_data)
-- ============================================================

CREATE TABLE plugin_data.dv_sd_sheet_sync_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  context_type text NOT NULL,             -- 'membership', 'tournament', 'activity_log'
  context_id uuid,                        -- FK to the specific record
  spreadsheet_id text NOT NULL,
  sheet_name text,
  sync_direction text DEFAULT 'push' CHECK (sync_direction IN ('push', 'pull', 'bidirectional')),
  column_mapping jsonb DEFAULT '{}',      -- Maps DB fields to sheet columns
  last_synced_at timestamptz,
  sync_enabled boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_dv_sd_sheet_sync_org ON plugin_data.dv_sd_sheet_sync_configs(organization_id);
CREATE INDEX idx_dv_sd_sheet_sync_context ON plugin_data.dv_sd_sheet_sync_configs(context_type, context_id);

COMMENT ON TABLE plugin_data.dv_sd_sheet_sync_configs IS 'Per-event Google Sheets sync configuration for DVSD data exports.';

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE plugin_data.dv_sd_tabroom_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_sheet_sync_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sheet_sync_staff" ON plugin_data.dv_sd_sheet_sync_configs
  FOR ALL USING (private.is_org_staff_or_admin(organization_id));
