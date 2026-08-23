-- Close the final application-runtime review gaps without rewriting the
-- already-applied control-plane migrations.

BEGIN;

ALTER FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_access_context(uuid, text, text)
  RENAME TO get_plugin_application_access_context_unhardened_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_application_access_context_unhardened_20260822(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_application_access_context_unhardened_20260822(uuid, text, text)
  TO postgres;

CREATE FUNCTION public.get_plugin_application_access_context(
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
  v_result jsonb;
  v_selected boolean := false;
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

  IF coalesce(v_result ->> 'reason', '') IN (
    'membership_required',
    'plugin_access_required'
  ) THEN
    RETURN v_result;
  END IF;

  IF coalesce((v_result ->> 'accessible')::boolean, false) = false THEN
    RETURN v_result;
  END IF;

  IF NOT coalesce(v_selected, false) THEN
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

REVOKE ALL ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_access_context(uuid, text, text)
  TO authenticated;

ALTER FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_runtime_admin_status(uuid, text, text)
  RENAME TO get_plugin_application_runtime_admin_status_unhardened_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_application_runtime_admin_status_unhardened_20260822(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_application_runtime_admin_status_unhardened_20260822(uuid, text, text)
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
  v_selected_release public.plugin_versions%ROWTYPE;
  v_deployment private.plugin_deployments%ROWTYPE;
  v_install record;
  v_flag record;
  v_accessible boolean := false;
  v_installed_key integer[];
  v_minimum_key integer[];
  v_maximum_key integer[];
  v_deployment_healthy boolean := false;
  v_contract_supported boolean := false;
BEGIN
  v_result := private.get_plugin_application_runtime_admin_status_unhardened_20260822(
    p_organization_id,
    p_plugin_key,
    p_environment
  );

  SELECT installs.enabled, installs.installed_version, installs.desired_version
  INTO v_install
  FROM public.organization_plugin_installs AS installs
  WHERE installs.organization_id = p_organization_id
    AND installs.plugin_key = p_plugin_key;

  SELECT flags.enabled, flags.metadata
  INTO v_flag
  FROM public.organization_plugin_feature_flags AS flags
  WHERE flags.organization_id = p_organization_id
    AND flags.plugin_key = p_plugin_key
    AND flags.flag_key = 'application-runtime';

  SELECT coalesce(access.is_accessible, false)
  INTO v_accessible
  FROM public.organization_plugin_access AS access
  WHERE access.organization_id = p_organization_id
    AND access.plugin_key = p_plugin_key;

  SELECT releases.*
  INTO v_release
  FROM public.plugin_versions AS releases
  WHERE releases.plugin_key = p_plugin_key
    AND releases.runtime_profile = 'application'
    AND releases.status = 'published'
    AND releases.signer_identity IS NOT NULL
  ORDER BY private.plugin_stable_semver_key(releases.version) DESC NULLS LAST
  LIMIT 1;

  IF v_install.desired_version IS NOT NULL THEN
    SELECT releases.*
    INTO v_selected_release
    FROM public.plugin_versions AS releases
    WHERE releases.plugin_key = p_plugin_key
      AND releases.version = v_install.desired_version
      AND releases.runtime_profile = 'application'
      AND releases.status = 'published'
      AND releases.signer_identity IS NOT NULL;
  END IF;

  IF v_release.plugin_key IS NOT NULL THEN
    SELECT deployments.*
    INTO v_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = v_release.version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
    ORDER BY deployments.health_reported_at DESC NULLS LAST,
      deployments.last_seen_at DESC
    LIMIT 1;
  END IF;

  v_deployment_healthy := v_deployment.id IS NOT NULL
    AND v_deployment.health_status = 'healthy'
    AND v_deployment.promotion_status IN ('deployed', 'promoted');
  v_installed_key := private.plugin_stable_semver_key(v_install.installed_version);
  v_minimum_key := private.plugin_stable_semver_key(
    v_release.supported_install_contracts ->> 'minimum'
  );
  v_maximum_key := private.plugin_stable_semver_key(
    v_release.supported_install_contracts ->> 'maximum'
  );
  v_contract_supported := v_installed_key IS NOT NULL
    AND v_minimum_key IS NOT NULL
    AND v_maximum_key IS NOT NULL
    AND v_installed_key >= v_minimum_key
    AND v_installed_key <= v_maximum_key;

  RETURN v_result || jsonb_build_object(
    'applicationVersion', v_release.version,
    'selectedApplicationVersion', v_selected_release.version,
    'applicationEnabled', coalesce(v_flag.enabled, false)
      AND v_selected_release.plugin_key IS NOT NULL
      AND v_flag.metadata ->> 'runtimeVersion' = v_install.desired_version,
    'deploymentHealthy', v_deployment_healthy,
    'deploymentId', v_deployment.deployment_id,
    'deploymentUrl', v_deployment.health_evidence ->> 'deploymentUrl',
    'healthReportedAt', v_deployment.health_reported_at,
    'installContractSupported', v_contract_supported,
    'canEnable', coalesce(v_install.enabled, false)
      AND coalesce(v_accessible, false)
      AND v_release.plugin_key IS NOT NULL
      AND v_deployment_healthy
      AND v_contract_supported
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
  RENAME TO set_plugin_application_runtime_unhardened_20260822;
REVOKE ALL ON FUNCTION private.set_plugin_application_runtime_unhardened_20260822(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.set_plugin_application_runtime_unhardened_20260822(uuid, text, text, text, boolean, uuid, uuid)
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
  v_install record;
  v_installed_key integer[];
  v_minimum_key integer[];
  v_maximum_key integer[];
  v_changed boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_organization_id IS NULL
    OR p_plugin_key IS NULL
    OR p_plugin_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_environment NOT IN ('development', 'production')
    OR p_enabled IS NULL
    OR p_actor_id IS NULL
    OR p_request_id IS NULL
    OR (p_enabled AND p_target_version IS NULL)
  THEN
    RAISE EXCEPTION 'valid application runtime transition coordinates are required'
      USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = p_organization_id
      AND members.user_id = p_actor_id
      AND members.role = 'admin'
      AND members.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active organization admin is required' USING errcode = '42501';
  END IF;

  SELECT installs.id, installs.enabled, installs.installed_version,
    installs.desired_version
  INTO v_install
  FROM public.organization_plugin_installs AS installs
  WHERE installs.organization_id = p_organization_id
    AND installs.plugin_key = p_plugin_key
  FOR UPDATE;

  IF NOT p_enabled AND v_install.id IS NOT NULL
    AND NOT coalesce(v_install.enabled, false)
  THEN
    v_changed := v_install.desired_version IS NOT NULL OR EXISTS (
      SELECT 1
      FROM public.organization_plugin_feature_flags AS flags
      WHERE flags.organization_id = p_organization_id
        AND flags.plugin_key = p_plugin_key
        AND flags.flag_key = 'application-runtime'
        AND flags.enabled
    );
    UPDATE public.organization_plugin_installs
    SET desired_version = NULL, updated_by = p_actor_id, updated_at = now()
    WHERE id = v_install.id;
    UPDATE public.organization_plugin_feature_flags
    SET enabled = false,
      rollout_percentage = 0,
      metadata = jsonb_build_object('environment', p_environment),
      updated_by = p_actor_id,
      updated_at = now()
    WHERE organization_id = p_organization_id
      AND plugin_key = p_plugin_key
      AND flag_key = 'application-runtime';
    RETURN public.get_plugin_application_runtime_admin_status(
      p_organization_id, p_plugin_key, p_environment
    ) || jsonb_build_object('changed', v_changed);
  END IF;

  IF p_enabled THEN
    SELECT releases.*
    INTO v_release
    FROM public.plugin_versions AS releases
    WHERE releases.plugin_key = p_plugin_key
      AND releases.version = p_target_version
      AND releases.runtime_profile = 'application'
      AND releases.status = 'published'
      AND releases.signer_identity IS NOT NULL;
    v_installed_key := private.plugin_stable_semver_key(v_install.installed_version);
    v_minimum_key := private.plugin_stable_semver_key(
      v_release.supported_install_contracts ->> 'minimum'
    );
    v_maximum_key := private.plugin_stable_semver_key(
      v_release.supported_install_contracts ->> 'maximum'
    );
    IF v_release.plugin_key IS NULL
      OR v_installed_key IS NULL
      OR v_minimum_key IS NULL
      OR v_maximum_key IS NULL
      OR v_installed_key < v_minimum_key
      OR v_installed_key > v_maximum_key
    THEN
      RAISE EXCEPTION 'the installed plugin version is incompatible with the requested application release'
        USING errcode = '55000';
    END IF;

    SELECT deployments.*
    INTO v_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = p_target_version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
    ORDER BY deployments.health_reported_at DESC NULLS LAST,
      deployments.last_seen_at DESC
    LIMIT 1;
    IF v_deployment.id IS NULL
      OR v_deployment.health_status <> 'healthy'
      OR v_deployment.promotion_status NOT IN ('deployed', 'promoted')
    THEN
      RAISE EXCEPTION 'the newest requested application deployment is not healthy'
        USING errcode = '55000';
    END IF;
  END IF;

  RETURN private.set_plugin_application_runtime_unhardened_20260822(
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

CREATE FUNCTION private.clear_plugin_application_runtime_on_install_disable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.enabled AND NOT NEW.enabled THEN
    NEW.desired_version := NULL;
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
BEFORE UPDATE OF enabled ON public.organization_plugin_installs
FOR EACH ROW
EXECUTE FUNCTION private.clear_plugin_application_runtime_on_install_disable();

COMMIT;
