-- Ensure every organization has an explicit data-isolation posture.
--
-- Shared isolation remains the default for normal organizations. Enterprise
-- upgrades can update this row to dedicated schema/project/external modes
-- without needing to infer missing state from the absence of a row.

BEGIN;

CREATE OR REPLACE FUNCTION private.ensure_organization_data_isolation_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  INSERT INTO public.organization_data_isolation_profiles (
    organization_id,
    isolation_mode,
    plugin_data_mode,
    export_policy,
    updated_by
  )
  VALUES (
    NEW.id,
    'shared',
    'shared_plugin_data',
    '{}'::jsonb,
    NEW.created_by
  )
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ensure_organization_data_isolation_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.ensure_organization_data_isolation_profile() TO service_role;

DROP TRIGGER IF EXISTS trg_ensure_organization_data_isolation_profile
  ON public.organizations;
CREATE TRIGGER trg_ensure_organization_data_isolation_profile
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_organization_data_isolation_profile();

INSERT INTO public.organization_data_isolation_profiles (
  organization_id,
  isolation_mode,
  plugin_data_mode,
  export_policy,
  updated_by
)
SELECT
  o.id,
  'shared',
  'shared_plugin_data',
  '{}'::jsonb,
  o.created_by
FROM public.organizations o
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
