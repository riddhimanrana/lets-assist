-- Migration: Grant authenticated + anon access to plugin_data schema
-- Required for PostgREST to serve plugin_data tables via the Data API.
-- RLS policies still control who can read/write what.

-- ============================================================
-- 1. Grant USAGE (allows connecting to the schema)
-- ============================================================

GRANT USAGE ON SCHEMA plugin_data TO authenticated;
GRANT USAGE ON SCHEMA plugin_data TO anon;

-- ============================================================
-- 2. Grant table access — RLS handles row-level restrictions
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA plugin_data
  TO authenticated;

GRANT SELECT
  ON ALL TABLES IN SCHEMA plugin_data
  TO anon;

-- ============================================================
-- 3. Grant sequence/function access
-- ============================================================

GRANT USAGE ON ALL SEQUENCES IN SCHEMA plugin_data TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA plugin_data TO authenticated;

-- ============================================================
-- 4. Default privileges for future tables
--    (so new plugin tables automatically get the right grants)
-- ============================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data
  GRANT USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
