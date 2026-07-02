-- Enterprise plugin isolation controls.
--
-- This migration starts the plugin redesign cutover by removing anonymous
-- direct Data API access to plugin_data and adding explicit organization-level
-- isolation metadata. Regular organizations continue to use the shared
-- Postgres/Supabase project; enterprise organizations can be marked for
-- dedicated schema/project/export handling without changing product code paths.

BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA plugin_data FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA plugin_data FROM anon;
REVOKE USAGE ON SCHEMA plugin_data FROM anon;

CREATE TABLE IF NOT EXISTS public.organization_data_isolation_profiles (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  isolation_mode text NOT NULL DEFAULT 'shared'
    CHECK (isolation_mode IN ('shared', 'dedicated_schema_ready', 'dedicated_project_ready', 'external')),
  plugin_data_mode text NOT NULL DEFAULT 'shared_plugin_data'
    CHECK (plugin_data_mode IN ('shared_plugin_data', 'dedicated_schema', 'dedicated_project', 'external')),
  requested_at timestamptz,
  activated_at timestamptz,
  allowed_regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  data_residency_notes text,
  export_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT organization_data_isolation_activation_check
    CHECK (activated_at IS NULL OR requested_at IS NULL OR activated_at >= requested_at)
);

COMMENT ON TABLE public.organization_data_isolation_profiles IS
  'Per-organization data isolation posture. Shared is the default; enterprise customers can be flagged for dedicated schema/project/external handling.';

CREATE INDEX IF NOT EXISTS idx_org_data_isolation_mode
  ON public.organization_data_isolation_profiles (isolation_mode, plugin_data_mode);

ALTER TABLE public.organization_data_isolation_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_data_isolation_admin_select ON public.organization_data_isolation_profiles;
CREATE POLICY organization_data_isolation_admin_select
  ON public.organization_data_isolation_profiles
  FOR SELECT
  TO authenticated
  USING (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_data_isolation_admin_insert ON public.organization_data_isolation_profiles;
CREATE POLICY organization_data_isolation_admin_insert
  ON public.organization_data_isolation_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_data_isolation_admin_update ON public.organization_data_isolation_profiles;
CREATE POLICY organization_data_isolation_admin_update
  ON public.organization_data_isolation_profiles
  FOR UPDATE
  TO authenticated
  USING (private.is_org_admin(organization_id) OR public.is_super_admin())
  WITH CHECK (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_data_isolation_super_admin_delete ON public.organization_data_isolation_profiles;
CREATE POLICY organization_data_isolation_super_admin_delete
  ON public.organization_data_isolation_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

CREATE TABLE IF NOT EXISTS public.organization_plugin_data_boundaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL REFERENCES public.plugins(key) ON DELETE CASCADE,
  boundary_status text NOT NULL DEFAULT 'active'
    CHECK (boundary_status IN ('active', 'disabled', 'migration_pending', 'archived')),
  data_schema text NOT NULL DEFAULT 'plugin_data',
  data_prefix text,
  isolation_mode text NOT NULL DEFAULT 'shared'
    CHECK (isolation_mode IN ('shared', 'dedicated_schema', 'dedicated_project', 'external')),
  direct_client_access text NOT NULL DEFAULT 'server_preferred'
    CHECK (direct_client_access IN ('blocked', 'server_preferred', 'rls_allowed')),
  allowed_relation_patterns text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (organization_id, plugin_key)
);

COMMENT ON TABLE public.organization_plugin_data_boundaries IS
  'Reviewable per-organization plugin data boundary. Used to plan/verify enterprise plugin data separation and direct client access reduction.';

CREATE INDEX IF NOT EXISTS idx_org_plugin_boundaries_plugin_status
  ON public.organization_plugin_data_boundaries (plugin_key, boundary_status);

CREATE INDEX IF NOT EXISTS idx_org_plugin_boundaries_isolation
  ON public.organization_plugin_data_boundaries (isolation_mode, direct_client_access);

ALTER TABLE public.organization_plugin_data_boundaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_plugin_boundaries_admin_select ON public.organization_plugin_data_boundaries;
CREATE POLICY organization_plugin_boundaries_admin_select
  ON public.organization_plugin_data_boundaries
  FOR SELECT
  TO authenticated
  USING (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_plugin_boundaries_admin_insert ON public.organization_plugin_data_boundaries;
CREATE POLICY organization_plugin_boundaries_admin_insert
  ON public.organization_plugin_data_boundaries
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_plugin_boundaries_admin_update ON public.organization_plugin_data_boundaries;
CREATE POLICY organization_plugin_boundaries_admin_update
  ON public.organization_plugin_data_boundaries
  FOR UPDATE
  TO authenticated
  USING (private.is_org_admin(organization_id) OR public.is_super_admin())
  WITH CHECK (private.is_org_admin(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS organization_plugin_boundaries_super_admin_delete ON public.organization_plugin_data_boundaries;
CREATE POLICY organization_plugin_boundaries_super_admin_delete
  ON public.organization_plugin_data_boundaries
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION private.sync_organization_plugin_data_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  INSERT INTO public.organization_plugin_data_boundaries (
    organization_id,
    plugin_key,
    boundary_status,
    data_schema,
    data_prefix,
    isolation_mode,
    direct_client_access,
    allowed_relation_patterns,
    notes
  )
  VALUES (
    NEW.organization_id,
    NEW.plugin_key,
    CASE WHEN NEW.enabled THEN 'active' ELSE 'disabled' END,
    'plugin_data',
    NEW.plugin_key,
    'shared',
    'server_preferred',
    ARRAY[]::text[],
    'Created from organization_plugin_installs trigger.'
  )
  ON CONFLICT (organization_id, plugin_key) DO UPDATE
  SET
    boundary_status = EXCLUDED.boundary_status,
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_organization_plugin_data_boundary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.sync_organization_plugin_data_boundary() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_organization_plugin_data_boundary
  ON public.organization_plugin_installs;
CREATE TRIGGER trg_sync_organization_plugin_data_boundary
  AFTER INSERT OR UPDATE OF enabled, plugin_key, organization_id
  ON public.organization_plugin_installs
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_organization_plugin_data_boundary();

INSERT INTO public.organization_plugin_data_boundaries (
  organization_id,
  plugin_key,
  boundary_status,
  data_schema,
  data_prefix,
  isolation_mode,
  direct_client_access,
  allowed_relation_patterns,
  notes
)
SELECT
  opi.organization_id,
  opi.plugin_key,
  CASE WHEN opi.enabled THEN 'active' ELSE 'disabled' END,
  'plugin_data',
  opi.plugin_key,
  'shared',
  'server_preferred',
  ARRAY[]::text[],
  'Seeded from current organization_plugin_installs during enterprise isolation controls migration.'
FROM public.organization_plugin_installs opi
ON CONFLICT (organization_id, plugin_key) DO UPDATE
SET
  boundary_status = EXCLUDED.boundary_status,
  updated_at = now();

CREATE OR REPLACE VIEW private.plugin_data_security_audit
WITH (security_invoker = true)
AS
WITH plugin_tables AS (
  SELECT
    c.oid,
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'plugin_data'
    AND c.relkind IN ('r', 'p')
),
tenant_columns AS (
  SELECT
    table_schema,
    table_name,
    bool_or(column_name = 'organization_id') AS has_organization_id
  FROM information_schema.columns
  WHERE table_schema = 'plugin_data'
  GROUP BY table_schema, table_name
),
anon_grants AS (
  SELECT
    table_schema,
    table_name,
    array_agg(privilege_type ORDER BY privilege_type) AS anon_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'plugin_data'
    AND grantee = 'anon'
  GROUP BY table_schema, table_name
),
authenticated_grants AS (
  SELECT
    table_schema,
    table_name,
    array_agg(privilege_type ORDER BY privilege_type) AS authenticated_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'plugin_data'
    AND grantee = 'authenticated'
  GROUP BY table_schema, table_name
)
SELECT
  t.schema_name,
  t.table_name,
  t.rls_enabled,
  t.force_rls,
  COALESCE(tc.has_organization_id, false) AS has_organization_id,
  COALESCE(ag.anon_privileges, ARRAY[]::text[]) AS anon_privileges,
  COALESCE(aug.authenticated_privileges, ARRAY[]::text[]) AS authenticated_privileges,
  CASE
    WHEN NOT t.rls_enabled THEN 'missing_rls'
    WHEN COALESCE(array_length(ag.anon_privileges, 1), 0) > 0 THEN 'anon_grant'
    WHEN NOT COALESCE(tc.has_organization_id, false)
      AND t.table_name NOT IN (
        'dv_sd_communication_deliveries',
        'dv_sd_family_service_ledger',
        'dv_sd_household_guardians',
        'dv_sd_household_students',
        'dv_sd_membership_requirements',
        'dv_sd_registration_entries',
        'dv_sd_tabroom_snapshots'
      ) THEN 'missing_tenant_column'
    ELSE 'ok'
  END AS audit_status
FROM plugin_tables t
LEFT JOIN tenant_columns tc
  ON tc.table_schema = t.schema_name
 AND tc.table_name = t.table_name
LEFT JOIN anon_grants ag
  ON ag.table_schema = t.schema_name
 AND ag.table_name = t.table_name
LEFT JOIN authenticated_grants aug
  ON aug.table_schema = t.schema_name
 AND aug.table_name = t.table_name;

COMMENT ON VIEW private.plugin_data_security_audit IS
  'Internal audit view for plugin_data RLS, tenant keys, and direct API grants. Not exposed through Supabase Data API.';

REVOKE ALL ON public.organization_data_isolation_profiles FROM anon;
REVOKE ALL ON public.organization_plugin_data_boundaries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_data_isolation_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_plugin_data_boundaries TO authenticated;
GRANT ALL ON public.organization_data_isolation_profiles TO service_role;
GRANT ALL ON public.organization_plugin_data_boundaries TO service_role;

COMMIT;
