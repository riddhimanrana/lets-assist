-- Route each organization to the immutable healthy deployment for its selected
-- application version. Also make an omitted host API maximum consistently mean
-- that the compatible range is unbounded above.

BEGIN;

CREATE OR REPLACE FUNCTION private.get_plugin_app_runtime_status_20260822(
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
      AND (
        NOT (v_release.host_api_range ? 'maximum')
        OR (
          v_host_maximum_key IS NOT NULL
          AND v_host_minimum_key <= v_host_maximum_key
          AND v_host_key <= v_host_maximum_key
        )
      )
      AND v_host_key >= v_host_minimum_key;
  END IF;

  v_deployment_healthy := v_deployment.id IS NOT NULL
    AND v_deployment.health_status = 'healthy'
    AND v_deployment.promotion_status IN ('deployed', 'promoted')
    AND v_deployment.health_evidence ->> 'deploymentUrl'
      ~ '^https://[a-z0-9][a-z0-9.-]*\.vercel\.app/?$'
    AND position(
      '..' in v_deployment.health_evidence ->> 'deploymentUrl'
    ) = 0;

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

REVOKE ALL ON FUNCTION private.get_plugin_app_runtime_status_20260822(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_app_runtime_status_20260822(uuid, text, text)
  TO postgres;

CREATE OR REPLACE FUNCTION private.set_plugin_application_runtime_compatibility_20260822(
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
  v_previous_deployment_id text;
  v_host_key integer[];
  v_host_minimum_key integer[];
  v_host_maximum_key integer[];
  v_result jsonb;
BEGIN
  IF p_enabled THEN
    SELECT flags.metadata ->> 'deploymentId'
    INTO v_previous_deployment_id
    FROM public.organization_plugin_feature_flags AS flags
    WHERE flags.organization_id = p_organization_id
      AND flags.plugin_key = p_plugin_key
      AND flags.flag_key = 'application-runtime';

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
        OR (
          v_release.host_api_range ? 'maximum'
          AND (
            v_host_maximum_key IS NULL
            OR v_host_minimum_key > v_host_maximum_key
            OR v_host_key > v_host_maximum_key
          )
        )
        OR v_host_key < v_host_minimum_key
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
      LIMIT 1
      FOR SHARE;
      IF v_deployment.id IS NULL
        OR v_deployment.health_status <> 'healthy'
        OR v_deployment.promotion_status NOT IN ('deployed', 'promoted')
      THEN
        RAISE EXCEPTION 'the newest requested application deployment is not healthy'
          USING errcode = '55000';
      END IF;
      IF v_deployment.health_evidence ->> 'deploymentUrl' IS NULL
        OR v_deployment.health_evidence ->> 'deploymentUrl'
          !~ '^https://[a-z0-9][a-z0-9.-]*\.vercel\.app/?$'
        OR position(
          '..' in v_deployment.health_evidence ->> 'deploymentUrl'
        ) > 0
      THEN
        RAISE EXCEPTION 'the newest requested application deployment is not routable'
          USING errcode = '55000';
      END IF;
    END IF;
  END IF;

  v_result := private.set_plugin_application_runtime_hardened_20260822(
    p_organization_id,
    p_plugin_key,
    p_target_version,
    p_environment,
    p_enabled,
    p_actor_id,
    p_request_id
  );

  IF p_enabled THEN
    UPDATE public.organization_plugin_feature_flags
    SET metadata = metadata || jsonb_build_object(
        'runtimeVersion', p_target_version,
        'environment', p_environment,
        'deploymentId', v_deployment.deployment_id
      ),
      updated_by = p_actor_id,
      updated_at = now()
    WHERE organization_id = p_organization_id
      AND plugin_key = p_plugin_key
      AND flag_key = 'application-runtime';

    IF coalesce((v_result ->> 'changed')::boolean, false) THEN
      UPDATE public.plugin_audit_logs
      SET details = details || jsonb_build_object(
          'deploymentId', v_deployment.deployment_id
        )
      WHERE organization_id = p_organization_id
        AND plugin_key = p_plugin_key
        AND action = 'install.updated'
        AND actor_id = p_actor_id
        AND details ->> 'requestId' = p_request_id::text;
    END IF;

    IF v_previous_deployment_id IS DISTINCT FROM v_deployment.deployment_id
      AND NOT coalesce((v_result ->> 'changed')::boolean, false)
    THEN
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
          'applicationRuntimeEnabled', true,
          'targetVersion', p_target_version,
          'environment', p_environment,
          'deploymentId', v_deployment.deployment_id,
          'requestId', p_request_id
        )
      );
    END IF;

    v_result := public.get_plugin_application_runtime_admin_status(
      p_organization_id,
      p_plugin_key,
      p_environment
    ) || jsonb_build_object(
      'changed', coalesce((v_result ->> 'changed')::boolean, false)
        OR v_previous_deployment_id IS DISTINCT FROM v_deployment.deployment_id
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.set_plugin_application_runtime_compatibility_20260822(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.set_plugin_application_runtime_compatibility_20260822(uuid, text, text, text, boolean, uuid, uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION public.report_plugin_deployment_health(
  p_plugin_key text,
  p_environment text,
  p_deployment_id text,
  p_health_status text,
  p_promotion_status text,
  p_health_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deployment private.plugin_deployments%ROWTYPE;
  v_existing_url text;
  v_reported_url text;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  IF p_health_status NOT IN ('healthy', 'unhealthy')
    OR p_promotion_status NOT IN ('deployed', 'promoted', 'rolled_back', 'retired')
    OR p_health_evidence IS NULL
    OR jsonb_typeof(p_health_evidence) <> 'object'
    OR p_health_evidence = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'a terminal health report and non-empty evidence are required'
      USING errcode = '22023';
  END IF;

  SELECT deployments.*
  INTO v_deployment
  FROM private.plugin_deployments AS deployments
  WHERE deployments.plugin_key = p_plugin_key
    AND deployments.environment = p_environment
    AND deployments.deployment_id = p_deployment_id
  FOR UPDATE;

  IF v_deployment.id IS NULL THEN
    RETURN false;
  END IF;

  v_existing_url := v_deployment.health_evidence ->> 'deploymentUrl';
  v_reported_url := p_health_evidence ->> 'deploymentUrl';
  IF v_deployment.runtime_profile = 'application'
    AND v_existing_url IS NOT NULL
    AND rtrim(v_existing_url, '/') IS DISTINCT FROM rtrim(v_reported_url, '/')
    AND EXISTS (
      SELECT 1
      FROM public.organization_plugin_feature_flags AS flags
      WHERE flags.plugin_key = p_plugin_key
        AND flags.flag_key = 'application-runtime'
        AND flags.enabled
        AND flags.metadata ->> 'environment' = p_environment
        AND flags.metadata ->> 'deploymentId' = p_deployment_id
    )
  THEN
    RAISE EXCEPTION 'plugin deployment URL cannot change after it is selected'
      USING errcode = '55000';
  END IF;

  UPDATE private.plugin_deployments
  SET health_status = p_health_status,
    promotion_status = p_promotion_status,
    health_evidence = p_health_evidence,
    health_reported_at = now(),
    last_seen_at = now()
  WHERE id = v_deployment.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  TO service_role;

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
  v_result jsonb;
  v_selected_version text;
  v_selected_deployment_id text;
  v_selected_environment text;
  v_selected_deployment private.plugin_deployments%ROWTYPE;
  v_selected_deployment_healthy boolean := false;
BEGIN
  v_result := private.get_plugin_app_runtime_status_20260822(
    p_organization_id,
    p_plugin_key,
    p_environment
  );
  v_selected_version := nullif(v_result ->> 'selectedApplicationVersion', '');

  SELECT
    flags.metadata ->> 'deploymentId',
    flags.metadata ->> 'environment'
  INTO v_selected_deployment_id, v_selected_environment
  FROM public.organization_plugin_feature_flags AS flags
  WHERE flags.organization_id = p_organization_id
    AND flags.plugin_key = p_plugin_key
    AND flags.flag_key = 'application-runtime';

  IF v_selected_version IS NOT NULL
    AND v_selected_deployment_id IS NOT NULL
    AND v_selected_environment = p_environment
  THEN
    SELECT deployments.*
    INTO v_selected_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = v_selected_version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
      AND deployments.deployment_id = v_selected_deployment_id
    LIMIT 1;
  END IF;

  v_selected_deployment_healthy := v_selected_deployment.id IS NOT NULL
    AND v_selected_deployment.health_status = 'healthy'
    AND v_selected_deployment.promotion_status IN ('deployed', 'promoted');

  RETURN v_result || jsonb_build_object(
    'selectedDeploymentHealthy', v_selected_deployment_healthy,
    'selectedDeploymentId', v_selected_deployment.deployment_id,
    'selectedDeploymentUrl',
      v_selected_deployment.health_evidence ->> 'deploymentUrl',
    'selectedHealthReportedAt', v_selected_deployment.health_reported_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  TO service_role;

CREATE FUNCTION public.get_plugin_application_route_target_by_identifier(
  p_organization_identifier text,
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
  v_actor_id uuid := (SELECT auth.uid());
  v_organization_id uuid;
  v_runtime_version text;
  v_selected_deployment_id text;
  v_access jsonb;
  v_deployment private.plugin_deployments%ROWTYPE;
  v_deployment_url text;
BEGIN
  IF (SELECT auth.role()) <> 'authenticated' OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authenticated session is required' USING errcode = '42501';
  END IF;

  IF p_organization_identifier IS NULL
    OR p_plugin_key IS NULL
    OR p_plugin_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_environment NOT IN ('development', 'production')
  THEN
    RAISE EXCEPTION 'valid plugin application route coordinates are required'
      USING errcode = '22023';
  END IF;

  IF p_organization_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_organization_id := p_organization_identifier::uuid;
  ELSIF char_length(p_organization_identifier) BETWEEN 3 AND 32
    AND p_organization_identifier COLLATE "C" ~ '^[a-z0-9_.-]+$'
    AND p_organization_identifier !~ '(^\.|\.$|\.\.)'
  THEN
    SELECT organizations.id
    INTO v_organization_id
    FROM public.organizations
    WHERE organizations.username = p_organization_identifier;
  ELSE
    RAISE EXCEPTION 'valid plugin application route coordinates are required'
      USING errcode = '22023';
  END IF;

  IF v_organization_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS members
    WHERE members.organization_id = v_organization_id
      AND members.user_id = v_actor_id
      AND members.status = 'active'
  ) THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  SELECT installs.desired_version, flags.metadata ->> 'deploymentId'
  INTO v_runtime_version, v_selected_deployment_id
  FROM public.organization_plugin_installs AS installs
  JOIN public.organization_plugin_feature_flags AS flags
    ON flags.organization_id = installs.organization_id
   AND flags.plugin_key = installs.plugin_key
   AND flags.flag_key = 'application-runtime'
  WHERE installs.organization_id = v_organization_id
    AND installs.plugin_key = p_plugin_key
    AND installs.enabled
    AND flags.enabled
    AND flags.metadata ->> 'runtimeVersion' = installs.desired_version
    AND flags.metadata ->> 'environment' = p_environment;

  IF v_runtime_version IS NULL OR v_selected_deployment_id IS NULL THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  v_access := public.get_plugin_application_access_context(
    v_organization_id,
    p_plugin_key,
    v_runtime_version
  );
  IF NOT coalesce((v_access ->> 'accessible')::boolean, false) THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  SELECT deployments.*
  INTO v_deployment
  FROM private.plugin_deployments AS deployments
  WHERE deployments.plugin_key = p_plugin_key
    AND deployments.version = v_runtime_version
    AND deployments.deployment_id = v_selected_deployment_id
    AND deployments.environment = p_environment
    AND deployments.runtime_profile = 'application'
    AND deployments.health_status = 'healthy'
    AND deployments.promotion_status IN ('deployed', 'promoted')
  LIMIT 1;

  v_deployment_url := v_deployment.health_evidence ->> 'deploymentUrl';
  IF v_deployment.id IS NULL
    OR v_deployment_url IS NULL
    OR v_deployment_url !~ '^https://[a-z0-9][a-z0-9.-]*\.vercel\.app/?$'
    OR position('..' in v_deployment_url) > 0
  THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'routable', true,
    'organizationId', v_organization_id,
    'pluginKey', p_plugin_key,
    'runtimeVersion', v_runtime_version,
    'deploymentId', v_deployment.deployment_id,
    'deploymentUrl', rtrim(v_deployment_url, '/')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text) IS
  'Returns an immutable healthy deployment URL only when the authenticated caller is an active member and the exact organization-selected application release remains accessible.';

CREATE OR REPLACE FUNCTION private.backfill_plugin_application_deployment_targets_20260822()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_audit_count integer;
BEGIN
  WITH ranked_existing_targets AS (
    SELECT
      flags.organization_id,
      flags.plugin_key,
      deployments.deployment_id,
      row_number() OVER (
        PARTITION BY flags.organization_id, flags.plugin_key
        ORDER BY deployments.last_seen_at DESC,
          deployments.first_seen_at DESC,
          deployments.id DESC
      ) AS target_rank
    FROM public.organization_plugin_feature_flags AS flags
    JOIN public.organization_plugin_installs AS installs
      ON installs.organization_id = flags.organization_id
     AND installs.plugin_key = flags.plugin_key
    JOIN private.plugin_deployments AS deployments
      ON deployments.plugin_key = flags.plugin_key
     AND deployments.version = installs.desired_version
     AND deployments.environment = flags.metadata ->> 'environment'
     AND deployments.runtime_profile = 'application'
     AND deployments.health_status = 'healthy'
     AND deployments.promotion_status IN ('deployed', 'promoted')
     AND deployments.health_evidence ->> 'deploymentUrl'
       ~ '^https://[a-z0-9][a-z0-9.-]*\.vercel\.app/?$'
     AND position(
       '..' in deployments.health_evidence ->> 'deploymentUrl'
     ) = 0
    WHERE flags.flag_key = 'application-runtime'
      AND flags.enabled
      AND installs.enabled
      AND installs.desired_version IS NOT NULL
      AND flags.metadata ->> 'runtimeVersion' = installs.desired_version
      AND NOT (flags.metadata ? 'deploymentId')
  ), backfilled_targets AS (
    UPDATE public.organization_plugin_feature_flags AS flags
    SET metadata = flags.metadata || jsonb_build_object(
        'deploymentId', targets.deployment_id
      ),
      updated_by = NULL,
      updated_at = now()
    FROM ranked_existing_targets AS targets
    WHERE targets.organization_id = flags.organization_id
      AND targets.plugin_key = flags.plugin_key
      AND targets.target_rank = 1
    RETURNING
      flags.organization_id,
      flags.plugin_key,
      flags.metadata ->> 'runtimeVersion' AS runtime_version,
      targets.deployment_id
  ), audit_entries AS (
    INSERT INTO public.plugin_audit_logs (
      organization_id,
      plugin_key,
      action,
      actor_id,
      actor_type,
      details
    )
    SELECT
      targets.organization_id,
      targets.plugin_key,
      'install.updated',
      NULL,
      'system',
      jsonb_build_object(
        'applicationRuntimeEnabled', true,
        'targetVersion', targets.runtime_version,
        'deploymentId', targets.deployment_id,
        'migrationBackfill', true
      )
    FROM backfilled_targets AS targets
    RETURNING 1
  )
  SELECT count(*)::integer
  INTO v_audit_count
  FROM audit_entries;

  RETURN v_audit_count;
END;
$$;

REVOKE ALL ON FUNCTION private.backfill_plugin_application_deployment_targets_20260822()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.backfill_plugin_application_deployment_targets_20260822()
  TO postgres;

SELECT private.backfill_plugin_application_deployment_targets_20260822();

COMMIT;
