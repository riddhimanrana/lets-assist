-- Give organization admins one reversible application-runtime choice. The
-- embedded install contract remains unchanged and is the rollback target.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_plugin_application_runtime_admin_status(
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
  v_release public.plugin_versions%ROWTYPE;
  v_deployment private.plugin_deployments%ROWTYPE;
  v_install record;
  v_flag record;
  v_plugin_accessible boolean := false;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;
  IF p_organization_id IS NULL
    OR p_plugin_key IS NULL
    OR p_plugin_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_environment NOT IN ('development', 'production')
  THEN
    RAISE EXCEPTION 'valid application runtime coordinates are required'
      USING errcode = '22023';
  END IF;

  SELECT releases.*
  INTO v_release
  FROM public.plugin_versions AS releases
  WHERE releases.plugin_key = p_plugin_key
    AND releases.runtime_profile = 'application'
    AND releases.status = 'published'
    AND releases.signer_identity IS NOT NULL
  ORDER BY private.plugin_stable_semver_key(releases.version) DESC NULLS LAST
  LIMIT 1;

  SELECT
    installs.enabled,
    installs.installed_version,
    installs.desired_version
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
  INTO v_plugin_accessible
  FROM public.organization_plugin_access AS access
  WHERE access.organization_id = p_organization_id
    AND access.plugin_key = p_plugin_key;

  IF v_release.plugin_key IS NOT NULL THEN
    SELECT deployments.*
    INTO v_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = v_release.version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
      AND deployments.health_status = 'healthy'
      AND deployments.promotion_status IN ('deployed', 'promoted')
    ORDER BY deployments.health_reported_at DESC NULLS LAST,
      deployments.last_seen_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'pluginKey', p_plugin_key,
    'environment', p_environment,
    'installed', v_install.installed_version IS NOT NULL,
    'installEnabled', coalesce(v_install.enabled, false),
    'pluginAccessible', coalesce(v_plugin_accessible, false),
    'installedVersion', v_install.installed_version,
    'desiredVersion', v_install.desired_version,
    'applicationVersion', v_release.version,
    'applicationPublished', v_release.plugin_key IS NOT NULL,
    'deploymentHealthy', v_deployment.id IS NOT NULL,
    'deploymentId', v_deployment.deployment_id,
    'deploymentUrl', v_deployment.health_evidence ->> 'deploymentUrl',
    'healthReportedAt', v_deployment.health_reported_at,
    'applicationEnabled', coalesce(v_flag.enabled, false)
      AND v_install.desired_version = v_release.version,
    'canEnable', coalesce(v_install.enabled, false)
      AND coalesce(v_plugin_accessible, false)
      AND v_release.plugin_key IS NOT NULL
      AND v_deployment.id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.set_plugin_application_runtime(
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
  v_install record;
  v_flag record;
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

  SELECT
    installs.id,
    installs.enabled,
    installs.installed_version,
    installs.desired_version
  INTO v_install
  FROM public.organization_plugin_installs AS installs
  WHERE installs.organization_id = p_organization_id
    AND installs.plugin_key = p_plugin_key
  FOR UPDATE;

  IF v_install.id IS NULL OR NOT coalesce(v_install.enabled, false) THEN
    RAISE EXCEPTION 'the embedded plugin installation must be enabled first'
      USING errcode = '55000';
  END IF;

  SELECT flags.enabled, flags.metadata
  INTO v_flag
  FROM public.organization_plugin_feature_flags AS flags
  WHERE flags.organization_id = p_organization_id
    AND flags.plugin_key = p_plugin_key
    AND flags.flag_key = 'application-runtime'
  FOR UPDATE;

  IF p_enabled THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_plugin_access AS access
      WHERE access.organization_id = p_organization_id
        AND access.plugin_key = p_plugin_key
        AND access.is_accessible
    ) THEN
      RAISE EXCEPTION 'active plugin access is required'
        USING errcode = '55000';
    END IF;

    SELECT releases.*
    INTO v_release
    FROM public.plugin_versions AS releases
    WHERE releases.plugin_key = p_plugin_key
      AND releases.version = p_target_version
      AND releases.runtime_profile = 'application'
      AND releases.status = 'published'
      AND releases.signer_identity IS NOT NULL;

    IF v_release.plugin_key IS NULL THEN
      RAISE EXCEPTION 'the requested signed application release is not published'
        USING errcode = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM private.plugin_deployments AS deployments
      WHERE deployments.plugin_key = p_plugin_key
        AND deployments.version = p_target_version
        AND deployments.environment = p_environment
        AND deployments.runtime_profile = 'application'
        AND deployments.health_status = 'healthy'
        AND deployments.promotion_status IN ('deployed', 'promoted')
    ) THEN
      RAISE EXCEPTION 'the requested application release has no healthy deployment'
        USING errcode = '55000';
    END IF;

    v_changed := v_install.desired_version IS DISTINCT FROM p_target_version
      OR NOT coalesce(v_flag.enabled, false)
      OR coalesce(v_flag.metadata ->> 'environment', '') IS DISTINCT FROM p_environment;

    UPDATE public.organization_plugin_installs
    SET desired_version = p_target_version,
      updated_by = p_actor_id,
      updated_at = now()
    WHERE id = v_install.id;

    INSERT INTO public.organization_plugin_feature_flags (
      organization_id,
      plugin_key,
      flag_key,
      enabled,
      rollout_percentage,
      metadata,
      updated_by,
      updated_at
    ) VALUES (
      p_organization_id,
      p_plugin_key,
      'application-runtime',
      true,
      100,
      jsonb_build_object(
        'runtimeVersion', p_target_version,
        'environment', p_environment
      ),
      p_actor_id,
      now()
    )
    ON CONFLICT (organization_id, plugin_key, flag_key) DO UPDATE
    SET enabled = true,
      rollout_percentage = 100,
      metadata = EXCLUDED.metadata,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  ELSE
    v_changed := v_install.desired_version IS NOT NULL
      OR coalesce(v_flag.enabled, false);

    UPDATE public.organization_plugin_installs
    SET desired_version = NULL,
      updated_by = p_actor_id,
      updated_at = now()
    WHERE id = v_install.id;

    INSERT INTO public.organization_plugin_feature_flags (
      organization_id,
      plugin_key,
      flag_key,
      enabled,
      rollout_percentage,
      metadata,
      updated_by,
      updated_at
    ) VALUES (
      p_organization_id,
      p_plugin_key,
      'application-runtime',
      false,
      0,
      jsonb_build_object('environment', p_environment),
      p_actor_id,
      now()
    )
    ON CONFLICT (organization_id, plugin_key, flag_key) DO UPDATE
    SET enabled = false,
      rollout_percentage = 0,
      metadata = EXCLUDED.metadata,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF v_changed THEN
    INSERT INTO public.plugin_audit_logs (
      organization_id,
      plugin_key,
      action,
      actor_id,
      actor_type,
      details
    ) VALUES (
      p_organization_id,
      p_plugin_key,
      'install.updated',
      p_actor_id,
      'user',
      jsonb_build_object(
        'applicationRuntimeEnabled', p_enabled,
        'targetVersion', CASE WHEN p_enabled THEN p_target_version ELSE NULL END,
        'environment', p_environment,
        'requestId', p_request_id
      )
    );
  END IF;

  RETURN public.get_plugin_application_runtime_admin_status(
    p_organization_id,
    p_plugin_key,
    p_environment
  ) || jsonb_build_object('changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  TO service_role;

COMMIT;
