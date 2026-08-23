-- Historical application access is a bounded grace period minted only while
-- that version is selected. Exact asset routing cannot create or renew it.

BEGIN;

CREATE OR REPLACE FUNCTION private.lease_plugin_application_runtime_20260822(
  p_organization_id uuid,
  p_plugin_key text,
  p_environment text,
  p_deployment_id text,
  p_runtime_version text,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM private.plugin_application_runtime_leases AS leases
  WHERE leases.actor_user_id = p_actor_user_id
    AND leases.expires_at <= now();

  INSERT INTO private.plugin_application_runtime_leases (
    organization_id,
    plugin_key,
    environment,
    deployment_id,
    runtime_version,
    actor_user_id,
    expires_at,
    last_seen_at
  ) VALUES (
    p_organization_id,
    p_plugin_key,
    p_environment,
    p_deployment_id,
    p_runtime_version,
    p_actor_user_id,
    now() + interval '12 hours',
    now()
  )
  ON CONFLICT (
    organization_id,
    plugin_key,
    environment,
    deployment_id,
    actor_user_id
  ) DO UPDATE
  SET runtime_version = EXCLUDED.runtime_version,
    expires_at = EXCLUDED.expires_at,
    last_seen_at = EXCLUDED.last_seen_at;
END;
$$;

ALTER FUNCTION private.lease_plugin_application_runtime_20260822(uuid, text, text, text, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lease_plugin_application_runtime_20260822(uuid, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.lease_plugin_application_runtime_20260822(uuid, text, text, text, text, uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION private.clear_disabled_plugin_application_runtime_leases_20260822()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.flag_key = 'application-runtime' AND NOT NEW.enabled THEN
    IF TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND OLD.enabled IS DISTINCT FROM NEW.enabled)
    THEN
      DELETE FROM private.plugin_application_runtime_leases AS leases
      WHERE leases.organization_id = NEW.organization_id
        AND leases.plugin_key = NEW.plugin_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.clear_disabled_plugin_application_runtime_leases_20260822()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.clear_disabled_plugin_application_runtime_leases_20260822()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.clear_disabled_plugin_application_runtime_leases_20260822()
  TO postgres;

DROP TRIGGER IF EXISTS clear_disabled_plugin_application_runtime_leases
  ON public.organization_plugin_feature_flags;
CREATE TRIGGER clear_disabled_plugin_application_runtime_leases
AFTER INSERT OR UPDATE OF enabled
ON public.organization_plugin_feature_flags
FOR EACH ROW
EXECUTE FUNCTION private.clear_disabled_plugin_application_runtime_leases_20260822();

CREATE OR REPLACE FUNCTION public.get_plugin_application_asset_route_target_by_identifier(
  p_organization_identifier text,
  p_plugin_key text,
  p_environment text,
  p_deployment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target jsonb;
  v_runtime_enabled boolean := false;
BEGIN
  v_target := private.get_plugin_application_asset_route_target_unleased_20260822(
    p_organization_identifier,
    p_plugin_key,
    p_environment,
    p_deployment_id
  );

  IF NOT coalesce((v_target ->> 'routable')::boolean, false) THEN
    RETURN v_target;
  END IF;

  SELECT coalesce(flags.enabled, false)
      AND flags.metadata ->> 'environment' = p_environment
  INTO v_runtime_enabled
  FROM public.organization_plugin_feature_flags AS flags
  WHERE flags.organization_id = (v_target ->> 'organizationId')::uuid
    AND flags.plugin_key = p_plugin_key
    AND flags.flag_key = 'application-runtime';

  IF NOT coalesce(v_runtime_enabled, false) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'routable', false,
      'reason', 'application_runtime_disabled'
    );
  END IF;

  RETURN v_target;
END;
$$;

ALTER FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  TO postgres, authenticated;

COMMENT ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text) IS
  'Returns one exact healthy application deployment while the runtime remains enabled. This client-callable route never creates or renews historical access.';

COMMIT;
