-- Make disabling an application runtime immediately invalidate historical
-- routing leases, including leases that have not reached their TTL.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_plugin_application_asset_route_target_by_identifier(
  p_organization_identifier text,
  p_plugin_key text,
  p_environment text,
  p_deployment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
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

  IF v_actor_id IS NOT NULL THEN
    PERFORM private.lease_plugin_application_runtime_20260822(
      (v_target ->> 'organizationId')::uuid,
      v_target ->> 'pluginKey',
      p_environment,
      v_target ->> 'deploymentId',
      v_target ->> 'runtimeVersion',
      v_actor_id
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
  'Returns and leases one exact healthy application deployment only while the organization application runtime remains enabled for that environment.';

CREATE OR REPLACE FUNCTION public.get_plugin_application_access_context(
  p_organization_id uuid,
  p_plugin_key text,
  p_runtime_version text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_result jsonb;
  v_selected boolean := false;
  v_leased boolean := false;
BEGIN
  v_result := private.get_plugin_application_access_context_unhardened_20260822(
    p_organization_id,
    p_plugin_key,
    p_runtime_version
  );

  SELECT coalesce(flags.enabled, false)
      AND installs.desired_version = p_runtime_version
      AND flags.metadata ->> 'runtimeVersion' = p_runtime_version
  INTO v_selected
  FROM public.organization_plugin_installs AS installs
  JOIN public.organization_plugin_feature_flags AS flags
    ON flags.organization_id = installs.organization_id
    AND flags.plugin_key = installs.plugin_key
    AND flags.flag_key = 'application-runtime'
  WHERE installs.organization_id = p_organization_id
    AND installs.plugin_key = p_plugin_key;

  IF NOT coalesce(v_selected, false) AND v_actor_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM private.plugin_application_runtime_leases AS leases
      JOIN private.plugin_deployments AS deployments
        ON deployments.plugin_key = leases.plugin_key
        AND deployments.environment = leases.environment
        AND deployments.deployment_id = leases.deployment_id
      JOIN public.organization_plugin_feature_flags AS flags
        ON flags.organization_id = leases.organization_id
        AND flags.plugin_key = leases.plugin_key
        AND flags.flag_key = 'application-runtime'
      WHERE leases.organization_id = p_organization_id
        AND leases.plugin_key = p_plugin_key
        AND leases.runtime_version = p_runtime_version
        AND leases.actor_user_id = v_actor_id
        AND leases.expires_at > now()
        AND flags.enabled
        AND flags.metadata ->> 'environment' = leases.environment
        AND deployments.version = p_runtime_version
        AND deployments.runtime_profile = 'application'
        AND deployments.health_status = 'healthy'
        AND deployments.promotion_status IN ('deployed', 'promoted')
    ) INTO v_leased;
  END IF;

  IF coalesce(v_result ->> 'reason', '') IN (
    'membership_required',
    'plugin_access_required'
  ) THEN
    RETURN v_result;
  END IF;

  IF coalesce((v_result ->> 'accessible')::boolean, false) = false THEN
    RETURN v_result;
  END IF;

  IF NOT coalesce(v_selected, false) AND NOT coalesce(v_leased, false) THEN
    IF v_result ->> 'membershipRole' NOT IN ('admin', 'staff') THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'accessible', false,
        'reason', 'plugin_access_required'
      );
    END IF;
    RETURN v_result || jsonb_build_object(
      'accessible', false,
      'reason', 'runtime_not_selected'
    );
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  TO postgres, authenticated;

COMMENT ON FUNCTION public.get_plugin_application_access_context(uuid, text, text) IS
  'Caller-scoped application access proof. Historical leases require the application runtime flag to remain enabled and still repeat current membership, entitlement, install, release, compatibility, health, and force-update checks.';

COMMIT;
