-- Keep requests from an already-rendered plugin application on their exact
-- healthy deployment while rechecking current caller and organization access.

BEGIN;

CREATE TABLE private.plugin_application_runtime_leases (
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL,
  environment text NOT NULL
    CHECK (environment IN ('development', 'production')),
  deployment_id text NOT NULL,
  runtime_version text NOT NULL,
  actor_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    organization_id,
    plugin_key,
    environment,
    deployment_id,
    actor_user_id
  ),
  FOREIGN KEY (plugin_key, environment, deployment_id)
    REFERENCES private.plugin_deployments(plugin_key, environment, deployment_id)
    ON DELETE CASCADE
);

ALTER TABLE private.plugin_application_runtime_leases OWNER TO postgres;
REVOKE ALL ON TABLE private.plugin_application_runtime_leases
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX plugin_application_runtime_leases_actor_expiry_idx
  ON private.plugin_application_runtime_leases (actor_user_id, expires_at);

CREATE INDEX plugin_application_runtime_leases_access_idx
  ON private.plugin_application_runtime_leases (
    organization_id,
    plugin_key,
    runtime_version,
    actor_user_id,
    expires_at
  );

CREATE INDEX plugin_application_runtime_leases_deployment_idx
  ON private.plugin_application_runtime_leases (
    plugin_key,
    environment,
    deployment_id
  );

COMMENT ON TABLE private.plugin_application_runtime_leases IS
  'Short caller-scoped proof that the host routed an authenticated request to one exact healthy plugin application deployment.';

CREATE FUNCTION private.lease_plugin_application_runtime_20260822(
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
    now() + interval '10 minutes',
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

ALTER FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_route_target_by_identifier(text, text, text)
  RENAME TO get_plugin_application_route_target_unleased_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_application_route_target_unleased_20260822(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_application_route_target_unleased_20260822(text, text, text)
  TO postgres;

CREATE FUNCTION public.get_plugin_application_route_target_by_identifier(
  p_organization_identifier text,
  p_plugin_key text,
  p_environment text
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
BEGIN
  v_target := private.get_plugin_application_route_target_unleased_20260822(
    p_organization_identifier,
    p_plugin_key,
    p_environment
  );

  IF v_actor_id IS NOT NULL
    AND coalesce((v_target ->> 'routable')::boolean, false)
  THEN
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

ALTER FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  TO postgres, authenticated;

COMMENT ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text) IS
  'Returns the selected immutable healthy application deployment and records a short caller-scoped runtime lease for the routed request.';

ALTER FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  RENAME TO get_plugin_application_asset_route_target_unleased_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_application_asset_route_target_unleased_20260822(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_application_asset_route_target_unleased_20260822(text, text, text, text)
  TO postgres;

CREATE FUNCTION public.get_plugin_application_asset_route_target_by_identifier(
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
BEGIN
  v_target := private.get_plugin_application_asset_route_target_unleased_20260822(
    p_organization_identifier,
    p_plugin_key,
    p_environment,
    p_deployment_id
  );

  IF v_actor_id IS NOT NULL
    AND coalesce((v_target ->> 'routable')::boolean, false)
  THEN
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
  'Returns one exact healthy application deployment and renews a short caller-scoped runtime lease while current organization access remains valid.';

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
      WHERE leases.organization_id = p_organization_id
        AND leases.plugin_key = p_plugin_key
        AND leases.runtime_version = p_runtime_version
        AND leases.actor_user_id = v_actor_id
        AND leases.expires_at > now()
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
  'Caller-scoped application access proof. A selected runtime or an unexpired exact-deployment lease may pass, but current membership, entitlement, install, release, compatibility, health, and force-update checks are always repeated.';

COMMIT;
