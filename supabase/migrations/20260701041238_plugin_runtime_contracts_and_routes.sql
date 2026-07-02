-- Plugin runtime contracts and organization-scoped plugin routes.
-- This creates a host-owned control-plane boundary for plugin capabilities so
-- plugins can declare custom UI routes, backend endpoints, storage needs, and
-- data-access contracts without requiring broad raw table exposure.

BEGIN;

CREATE TABLE IF NOT EXISTS public.plugin_runtime_contracts (
  plugin_key text PRIMARY KEY REFERENCES public.plugins(key) ON DELETE CASCADE,
  manifest_version text NOT NULL,
  minimum_role text NOT NULL DEFAULT 'member'
    CHECK (minimum_role IN ('admin', 'staff', 'member')),
  routes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(routes) = 'array'),
  surfaces jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(surfaces) = 'array'),
  behavior_hooks jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(behavior_hooks) = 'array'),
  backend_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(backend_capabilities) = 'array'),
  data_access jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(data_access) = 'array'),
  storage_access jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(storage_access) = 'array'),
  required_scopes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(required_scopes) = 'array'),
  lifecycle_hooks jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(lifecycle_hooks) = 'array'),
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plugin_runtime_contracts IS
  'Server-managed runtime contract for each registered plugin. Records routes, surfaces, backend capabilities, storage needs, and data access declarations for audit and admin review.';

COMMENT ON COLUMN public.plugin_runtime_contracts.data_access IS
  'Array of declared plugin data dependencies. Prefer server-only, RPC, or read-model access over direct plugin_data browser access.';

CREATE INDEX IF NOT EXISTS idx_plugin_runtime_contracts_minimum_role
  ON public.plugin_runtime_contracts(minimum_role);

ALTER TABLE public.plugin_runtime_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plugin_runtime_contracts_admin_read" ON public.plugin_runtime_contracts;
CREATE POLICY "plugin_runtime_contracts_admin_read"
  ON public.plugin_runtime_contracts
  FOR SELECT
  TO authenticated
  USING (public.is_trusted_member((SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS public.organization_plugin_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL REFERENCES public.plugins(key) ON DELETE CASCADE,
  route_path text NOT NULL,
  label text NOT NULL,
  title text,
  description text,
  minimum_role text NOT NULL DEFAULT 'member'
    CHECK (minimum_role IN ('admin', 'staff', 'member')),
  nav_section text NOT NULL DEFAULT 'plugin'
    CHECK (nav_section IN ('plugin', 'organization', 'hidden')),
  enabled boolean NOT NULL DEFAULT true,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    route_path ~ '^[a-z0-9][a-z0-9/-]*[a-z0-9]$'
    AND route_path !~ '/{2,}'
    AND route_path NOT LIKE '%..%'
  ),
  UNIQUE (organization_id, route_path),
  UNIQUE (organization_id, plugin_key, route_path)
);

COMMENT ON TABLE public.organization_plugin_routes IS
  'Organization-scoped plugin route registry. Allows a plugin to own custom subroutes for a specific organization without broad route-table exposure.';

CREATE INDEX IF NOT EXISTS idx_org_plugin_routes_org
  ON public.organization_plugin_routes(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_plugin_routes_plugin
  ON public.organization_plugin_routes(plugin_key);

CREATE INDEX IF NOT EXISTS idx_org_plugin_routes_enabled
  ON public.organization_plugin_routes(organization_id, plugin_key, enabled);

ALTER TABLE public.organization_plugin_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_plugin_routes_member_read" ON public.organization_plugin_routes;
CREATE POLICY "organization_plugin_routes_member_read"
  ON public.organization_plugin_routes
  FOR SELECT
  TO authenticated
  USING (
    enabled = true
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_routes.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff', 'member'])
    )
  );

DROP POLICY IF EXISTS "organization_plugin_routes_staff_insert" ON public.organization_plugin_routes;
CREATE POLICY "organization_plugin_routes_staff_insert"
  ON public.organization_plugin_routes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_routes.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff'])
    )
  );

DROP POLICY IF EXISTS "organization_plugin_routes_staff_update" ON public.organization_plugin_routes;
CREATE POLICY "organization_plugin_routes_staff_update"
  ON public.organization_plugin_routes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_routes.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_routes.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff'])
    )
  );

DROP POLICY IF EXISTS "organization_plugin_routes_admin_delete" ON public.organization_plugin_routes;
CREATE POLICY "organization_plugin_routes_admin_delete"
  ON public.organization_plugin_routes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_routes.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = 'admin'
    )
  );

COMMIT;
