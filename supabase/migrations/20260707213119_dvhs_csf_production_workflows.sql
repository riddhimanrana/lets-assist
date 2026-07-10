-- Add production workflow metadata for DVHS CSF operations.
--
-- These tables stay inside plugin_data. They are not exposed directly to
-- anon/authenticated clients; plugin server actions own all access.

BEGIN;

UPDATE public.organizations
SET show_members_publicly = false
WHERE username = 'dvhs-csf';

ALTER TABLE IF EXISTS plugin_data.csf_sheet_sources
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_previewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_policy text NOT NULL DEFAULT 'match_email_then_name',
  ADD COLUMN IF NOT EXISTS column_mappings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_sync_status_check,
  ADD CONSTRAINT csf_sheet_sources_sync_status_check
    CHECK (sync_status IN ('not_synced', 'healthy', 'needs_attention', 'failed', 'disabled'));

ALTER TABLE IF EXISTS plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_duplicate_policy_check,
  ADD CONSTRAINT csf_sheet_sources_duplicate_policy_check
    CHECK (duplicate_policy IN ('match_email_then_name', 'match_name_only', 'manual_review'));

ALTER TABLE IF EXISTS plugin_data.csf_sheet_sources
  DROP CONSTRAINT IF EXISTS csf_sheet_sources_column_mappings_object_check,
  ADD CONSTRAINT csf_sheet_sources_column_mappings_object_check
    CHECK (jsonb_typeof(column_mappings) = 'object');

CREATE INDEX IF NOT EXISTS csf_sheet_sources_org_sync_status_idx
  ON plugin_data.csf_sheet_sources (organization_id, sync_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plugin_data.csf_sheet_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid REFERENCES plugin_data.csf_sheet_sources(id) ON DELETE SET NULL,
  job_id uuid REFERENCES plugin_data.csf_sheet_import_jobs(id) ON DELETE SET NULL,
  level text NOT NULL DEFAULT 'info'
    CHECK (level IN ('info', 'warning', 'error')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_sheet_sync_logs_org_source_idx
  ON plugin_data.csf_sheet_sync_logs (organization_id, source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS csf_sheet_sync_logs_job_idx
  ON plugin_data.csf_sheet_sync_logs (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_opportunity_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES plugin_data.csf_opportunities(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES plugin_data.csf_profiles(id) ON DELETE SET NULL,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'external_sheet'
    CHECK (source IN ('external_sheet', 'lets_assist_project', 'manual', 'import')),
  signup_status text NOT NULL DEFAULT 'signed_up'
    CHECK (signup_status IN ('signed_up', 'waitlisted', 'cancelled', 'no_show', 'attended', 'credited')),
  attendance_status text NOT NULL DEFAULT 'unknown'
    CHECK (attendance_status IN ('unknown', 'attended', 'missed', 'excused', 'verified')),
  signup_name text,
  signup_email text,
  external_row_id text,
  signed_up_at timestamptz,
  attendance_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attendance_verified_at timestamptz,
  points_expected numeric(6,2),
  evidence_url text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id, profile_id)
);

CREATE INDEX IF NOT EXISTS csf_opportunity_signups_org_status_idx
  ON plugin_data.csf_opportunity_signups (organization_id, signup_status, attendance_status, created_at DESC);

CREATE INDEX IF NOT EXISTS csf_opportunity_signups_opportunity_idx
  ON plugin_data.csf_opportunity_signups (opportunity_id, signup_status);

CREATE INDEX IF NOT EXISTS csf_opportunity_signups_profile_idx
  ON plugin_data.csf_opportunity_signups (organization_id, profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plugin_data.csf_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'members'
    CHECK (audience IN ('members', 'officers', 'class', 'public')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_announcements_org_status_idx
  ON plugin_data.csf_announcements (organization_id, status, pinned DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS csf_announcements_term_idx
  ON plugin_data.csf_announcements (term_id, status)
  WHERE term_id IS NOT NULL;

DO $$
DECLARE
  _table text;
  _tables text[] := ARRAY[
    'csf_sheet_sync_logs',
    'csf_opportunity_signups',
    'csf_announcements'
  ];
BEGIN
  FOREACH _table IN ARRAY _tables LOOP
    EXECUTE format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY', _table);
    EXECUTE format('REVOKE ALL ON TABLE plugin_data.%I FROM anon, authenticated', _table);
    EXECUTE format('GRANT ALL ON TABLE plugin_data.%I TO service_role', _table);
  END LOOP;
END $$;

COMMENT ON COLUMN plugin_data.csf_sheet_sources.sync_status IS
  'Current officer-facing health state for this Google Sheets source.';

COMMENT ON COLUMN plugin_data.csf_sheet_sources.column_mappings IS
  'Officer-reviewed mapping from spreadsheet headers to CSF import fields.';

COMMENT ON TABLE plugin_data.csf_sheet_sync_logs IS
  'Append-only operational log for CSF Google Sheets previews, commits, validation warnings, and export syncs.';

COMMENT ON TABLE plugin_data.csf_opportunity_signups IS
  'Imported or native sign-up roster rows for CSF opportunities, linked to profiles when matching is confident.';

COMMENT ON TABLE plugin_data.csf_announcements IS
  'Officer-authored member announcements separate from point-bearing opportunity posts.';

COMMIT;
