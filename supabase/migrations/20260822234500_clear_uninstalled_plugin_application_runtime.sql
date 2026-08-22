-- Uninstall is a security boundary. Remove runtime state in the same
-- transaction that deletes the organization install row.

BEGIN;

CREATE OR REPLACE FUNCTION private.clear_uninstalled_plugin_application_runtime_20260822()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.organization_plugin_feature_flags AS flags
  SET enabled = false,
    updated_at = now()
  WHERE flags.organization_id = OLD.organization_id
    AND flags.plugin_key = OLD.plugin_key
    AND flags.flag_key = 'application-runtime'
    AND flags.enabled;

  DELETE FROM private.plugin_application_runtime_leases AS leases
  WHERE leases.organization_id = OLD.organization_id
    AND leases.plugin_key = OLD.plugin_key;

  RETURN OLD;
END;
$$;

ALTER FUNCTION private.clear_uninstalled_plugin_application_runtime_20260822()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.clear_uninstalled_plugin_application_runtime_20260822()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.clear_uninstalled_plugin_application_runtime_20260822()
  TO postgres;

DROP TRIGGER IF EXISTS clear_uninstalled_plugin_application_runtime
  ON public.organization_plugin_installs;
CREATE TRIGGER clear_uninstalled_plugin_application_runtime
AFTER DELETE
ON public.organization_plugin_installs
FOR EACH ROW
EXECUTE FUNCTION private.clear_uninstalled_plugin_application_runtime_20260822();

COMMIT;
