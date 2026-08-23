-- Complete application runtime compatibility checks without rewriting the
-- already-applied runtime control migrations.

BEGIN;

ALTER FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_runtime_admin_status(uuid, text, text)
  RENAME TO get_plugin_application_runtime_admin_status_hardened_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_application_runtime_admin_status_hardened_20260822(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_application_runtime_admin_status_hardened_20260822(uuid, text, text)
  TO postgres;

CREATE FUNCTION public.get_plugin_application_runtime_admin_status(
  p_organization_id uuid,
  p_plugin_key text,
  p_environment text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_release public.plugin_versions%ROWTYPE;
  v_deployment private.plugin_deployments%ROWTYPE;
  v_host_key integer[];
  v_host_minimum_key integer[];
  v_host_maximum_key integer[];
  v_host_supported boolean := false;
  v_deployment_healthy boolean := false;
BEGIN
  v_result := private.get_plugin_application_runtime_admin_status_hardened_20260822(
    p_organization_id,
    p_plugin_key,
    p_environment
  );

  SELECT releases.*
  INTO v_release
  FROM public.plugin_versions AS releases
  WHERE releases.plugin_key = p_plugin_key
    AND releases.runtime_profile = 'application'
    AND releases.status = 'published'
    AND releases.signer_identity IS NOT NULL
  ORDER BY private.plugin_stable_semver_key(releases.version) DESC NULLS LAST
  LIMIT 1;

  IF v_release.plugin_key IS NOT NULL THEN
    SELECT deployments.*
    INTO v_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = v_release.version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
    ORDER BY deployments.last_seen_at DESC,
      deployments.first_seen_at DESC,
      deployments.id DESC
    LIMIT 1;

    v_host_key := private.plugin_stable_semver_key(
      private.plugin_host_api_version()
    );
    v_host_minimum_key := private.plugin_stable_semver_key(
      v_release.host_api_range ->> 'minimum'
    );
    v_host_maximum_key := private.plugin_stable_semver_key(
      v_release.host_api_range ->> 'maximum'
    );
    v_host_supported := v_host_key IS NOT NULL
      AND v_host_minimum_key IS NOT NULL
      AND v_host_maximum_key IS NOT NULL
      AND v_host_minimum_key <= v_host_maximum_key
      AND v_host_key >= v_host_minimum_key
      AND v_host_key <= v_host_maximum_key;
  END IF;

  v_deployment_healthy := v_deployment.id IS NOT NULL
    AND v_deployment.health_status = 'healthy'
    AND v_deployment.promotion_status IN ('deployed', 'promoted');

  RETURN v_result || jsonb_build_object(
    'deploymentHealthy', v_deployment_healthy,
    'deploymentId', v_deployment.deployment_id,
    'deploymentUrl', v_deployment.health_evidence ->> 'deploymentUrl',
    'healthReportedAt', v_deployment.health_reported_at,
    'hostApiSupported', v_host_supported,
    'canEnable', coalesce((v_result ->> 'installEnabled')::boolean, false)
      AND coalesce((v_result ->> 'pluginAccessible')::boolean, false)
      AND coalesce((v_result ->> 'applicationPublished')::boolean, false)
      AND coalesce((v_result ->> 'installContractSupported')::boolean, false)
      AND v_deployment_healthy
      AND v_host_supported
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  TO service_role;

ALTER FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  SET SCHEMA private;
ALTER FUNCTION private.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  RENAME TO set_plugin_application_runtime_hardened_20260822;
REVOKE ALL ON FUNCTION private.set_plugin_application_runtime_hardened_20260822(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.set_plugin_application_runtime_hardened_20260822(uuid, text, text, text, boolean, uuid, uuid)
  TO postgres;

CREATE FUNCTION public.set_plugin_application_runtime(
  p_organization_id uuid,
  p_plugin_key text,
  p_target_version text,
  p_environment text,
  p_enabled boolean,
  p_actor_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_release public.plugin_versions%ROWTYPE;
  v_deployment private.plugin_deployments%ROWTYPE;
  v_host_key integer[];
  v_host_minimum_key integer[];
  v_host_maximum_key integer[];
BEGIN
  IF p_enabled THEN
    SELECT releases.*
    INTO v_release
    FROM public.plugin_versions AS releases
    WHERE releases.plugin_key = p_plugin_key
      AND releases.version = p_target_version
      AND releases.runtime_profile = 'application'
      AND releases.status = 'published'
      AND releases.signer_identity IS NOT NULL;

    IF v_release.plugin_key IS NOT NULL THEN
      v_host_key := private.plugin_stable_semver_key(
        private.plugin_host_api_version()
      );
      v_host_minimum_key := private.plugin_stable_semver_key(
        v_release.host_api_range ->> 'minimum'
      );
      v_host_maximum_key := private.plugin_stable_semver_key(
        v_release.host_api_range ->> 'maximum'
      );
      IF v_host_key IS NULL
        OR v_host_minimum_key IS NULL
        OR v_host_maximum_key IS NULL
        OR v_host_minimum_key > v_host_maximum_key
        OR v_host_key < v_host_minimum_key
        OR v_host_key > v_host_maximum_key
      THEN
        RAISE EXCEPTION 'the requested application release does not support the current host API'
          USING errcode = '55000';
      END IF;

      SELECT deployments.*
      INTO v_deployment
      FROM private.plugin_deployments AS deployments
      WHERE deployments.plugin_key = p_plugin_key
        AND deployments.version = p_target_version
        AND deployments.environment = p_environment
        AND deployments.runtime_profile = 'application'
      ORDER BY deployments.last_seen_at DESC,
        deployments.first_seen_at DESC,
        deployments.id DESC
      LIMIT 1;
      IF v_deployment.id IS NULL
        OR v_deployment.health_status <> 'healthy'
        OR v_deployment.promotion_status NOT IN ('deployed', 'promoted')
      THEN
        RAISE EXCEPTION 'the newest requested application deployment is not healthy'
          USING errcode = '55000';
      END IF;
    END IF;
  END IF;

  RETURN private.set_plugin_application_runtime_hardened_20260822(
    p_organization_id,
    p_plugin_key,
    p_target_version,
    p_environment,
    p_enabled,
    p_actor_id,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION private.clear_plugin_application_runtime_on_install_disable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_installed_key integer[];
BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
    NEW.desired_version := NULL;
  ELSIF NEW.installed_version IS DISTINCT FROM OLD.installed_version
    AND NEW.desired_version IS NOT NULL
  THEN
    v_installed_key := private.plugin_stable_semver_key(NEW.installed_version);
    IF v_installed_key IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.plugin_versions AS releases
      WHERE releases.plugin_key = NEW.plugin_key
        AND releases.version = NEW.desired_version
        AND releases.runtime_profile = 'application'
        AND releases.status = 'published'
        AND releases.signer_identity IS NOT NULL
        AND private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'minimum'
        ) IS NOT NULL
        AND private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'maximum'
        ) IS NOT NULL
        AND private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'minimum'
        ) <= private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'maximum'
        )
        AND v_installed_key >= private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'minimum'
        )
        AND v_installed_key <= private.plugin_stable_semver_key(
          releases.supported_install_contracts ->> 'maximum'
        )
    ) THEN
      NEW.desired_version := NULL;
    END IF;
  END IF;

  IF OLD.desired_version IS NOT NULL AND NEW.desired_version IS NULL THEN
    UPDATE public.organization_plugin_feature_flags
    SET enabled = false,
      rollout_percentage = 0,
      metadata = coalesce(metadata, '{}'::jsonb) - 'runtimeVersion',
      updated_by = NEW.updated_by,
      updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND plugin_key = NEW.plugin_key
      AND flag_key = 'application-runtime';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_plugin_application_runtime_on_install_disable()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.clear_plugin_application_runtime_on_install_disable()
  TO postgres;

DROP TRIGGER IF EXISTS clear_plugin_application_runtime_on_install_disable
  ON public.organization_plugin_installs;
CREATE TRIGGER clear_plugin_application_runtime_on_install_disable
BEFORE UPDATE OF enabled, installed_version ON public.organization_plugin_installs
FOR EACH ROW
EXECUTE FUNCTION private.clear_plugin_application_runtime_on_install_disable();

COMMIT;
