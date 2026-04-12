-- Migration: Create plugin_data and private schemas
-- These schemas isolate plugin-specific data from the public Data API.
-- plugin_data: stores all plugin tables (DVSD, forms, billing, AI logs)
-- private: houses SECURITY DEFINER functions for safe RLS evaluation

-- ============================================================
-- 1. Create schemas
-- ============================================================

CREATE SCHEMA IF NOT EXISTS plugin_data;
CREATE SCHEMA IF NOT EXISTS private;

COMMENT ON SCHEMA plugin_data IS 'Plugin-specific data tables. Not exposed via Data API. Accessed by service role only.';
COMMENT ON SCHEMA private IS 'Security definer helper functions for RLS policies.';

-- ============================================================
-- 2. Grant access to service_role (bypasses RLS anyway, but needs schema usage)
-- ============================================================

GRANT USAGE ON SCHEMA plugin_data TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_data TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA plugin_data GRANT ALL ON FUNCTIONS TO service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ============================================================
-- 3. Helper functions in private schema (SECURITY DEFINER)
-- These run with the privileges of the function owner (postgres),
-- allowing RLS policies to check org membership without exposing
-- the plugin_data schema to the Data API.
-- ============================================================

-- Check if the current authenticated user has a specific role (or higher) in an org
CREATE OR REPLACE FUNCTION private.get_user_org_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.organization_members
  WHERE organization_id = p_org_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION private.get_user_org_role IS 'Returns the current user''s role in the given organization, or NULL if not a member.';

-- Check if the current user is at least a member of the org
CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION private.is_org_member IS 'Returns true if the current user is a member of the organization.';

-- Check if the current user is staff or admin of the org
CREATE OR REPLACE FUNCTION private.is_org_staff_or_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('admin', 'staff')
  );
$$;

COMMENT ON FUNCTION private.is_org_staff_or_admin IS 'Returns true if the current user is staff or admin of the organization.';

-- Check if the current user is an admin of the org
CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION private.is_org_admin IS 'Returns true if the current user is an admin of the organization.';

-- Check if a plugin is installed and enabled for an org
CREATE OR REPLACE FUNCTION private.is_plugin_enabled(p_org_id uuid, p_plugin_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_plugin_installs
    WHERE organization_id = p_org_id
      AND plugin_key = p_plugin_key
      AND enabled = true
  );
$$;

COMMENT ON FUNCTION private.is_plugin_enabled IS 'Returns true if the plugin is installed and enabled for the organization.';
