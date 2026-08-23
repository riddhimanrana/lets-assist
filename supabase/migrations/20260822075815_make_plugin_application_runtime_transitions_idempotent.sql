-- Make application runtime changes safe to retry and report the deployment
-- that belongs to the selected version separately from the newest candidate.

BEGIN;

CREATE TABLE private.plugin_application_runtime_transitions (
  request_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL
    REFERENCES public.plugins(key) ON DELETE CASCADE,
  environment text NOT NULL
    CHECK (environment IN ('development', 'production')),
  enabled boolean NOT NULL,
  target_version text,
  expected_enabled boolean NOT NULL,
  expected_version text,
  actor_id uuid NOT NULL,
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(outcome) = 'object'),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((enabled AND target_version IS NOT NULL) OR (NOT enabled AND target_version IS NULL)),
  CHECK (
    (expected_enabled AND expected_version IS NOT NULL)
    OR (NOT expected_enabled AND expected_version IS NULL)
  ),
  FOREIGN KEY (plugin_key, target_version)
    REFERENCES public.plugin_versions(plugin_key, version),
  FOREIGN KEY (plugin_key, expected_version)
    REFERENCES public.plugin_versions(plugin_key, version)
);

COMMENT ON TABLE private.plugin_application_runtime_transitions IS
  'Durable, payload-bound receipts for retry-safe organization runtime choices.';

CREATE INDEX plugin_application_runtime_transitions_org_idx
  ON private.plugin_application_runtime_transitions (
    organization_id,
    plugin_key,
    created_at
  );
CREATE INDEX plugin_application_runtime_transitions_target_idx
  ON private.plugin_application_runtime_transitions (plugin_key, target_version)
  WHERE target_version IS NOT NULL;
CREATE INDEX plugin_application_runtime_transitions_expected_idx
  ON private.plugin_application_runtime_transitions (plugin_key, expected_version)
  WHERE expected_version IS NOT NULL;

REVOKE ALL ON TABLE private.plugin_application_runtime_transitions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE private.plugin_application_runtime_transitions
  TO postgres;

ALTER FUNCTION public.get_plugin_application_runtime_admin_status(uuid, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_runtime_admin_status(uuid, text, text)
  RENAME TO get_plugin_app_runtime_status_20260822;
REVOKE ALL ON FUNCTION private.get_plugin_app_runtime_status_20260822(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.get_plugin_app_runtime_status_20260822(uuid, text, text)
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
  v_selected_version text;
  v_selected_deployment private.plugin_deployments%ROWTYPE;
  v_selected_deployment_healthy boolean := false;
BEGIN
  v_result := private.get_plugin_app_runtime_status_20260822(
    p_organization_id,
    p_plugin_key,
    p_environment
  );
  v_selected_version := nullif(v_result ->> 'selectedApplicationVersion', '');

  IF v_selected_version IS NOT NULL THEN
    SELECT deployments.*
    INTO v_selected_deployment
    FROM private.plugin_deployments AS deployments
    WHERE deployments.plugin_key = p_plugin_key
      AND deployments.version = v_selected_version
      AND deployments.environment = p_environment
      AND deployments.runtime_profile = 'application'
    ORDER BY deployments.last_seen_at DESC,
      deployments.first_seen_at DESC,
      deployments.id DESC
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

ALTER FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  SET SCHEMA private;
ALTER FUNCTION private.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid)
  RENAME TO set_plugin_application_runtime_compatibility_20260822;
REVOKE ALL ON FUNCTION private.set_plugin_application_runtime_compatibility_20260822(uuid, text, text, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.set_plugin_application_runtime_compatibility_20260822(uuid, text, text, text, boolean, uuid, uuid)
  TO postgres;

CREATE FUNCTION public.set_plugin_application_runtime(
  p_organization_id uuid,
  p_plugin_key text,
  p_target_version text,
  p_environment text,
  p_enabled boolean,
  p_actor_id uuid,
  p_request_id uuid,
  p_expected_enabled boolean,
  p_expected_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transition private.plugin_application_runtime_transitions%ROWTYPE;
  v_install record;
  v_flag record;
  v_actual_enabled boolean := false;
  v_actual_version text;
  v_outcome jsonb;
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
    OR p_expected_enabled IS NULL
    OR (p_enabled AND p_target_version IS NULL)
    OR (NOT p_enabled AND p_target_version IS NOT NULL)
    OR (p_expected_enabled AND p_expected_version IS NULL)
    OR (NOT p_expected_enabled AND p_expected_version IS NOT NULL)
  THEN
    RAISE EXCEPTION 'valid application runtime transition coordinates are required'
      USING errcode = '22023';
  END IF;

  INSERT INTO private.plugin_application_runtime_transitions (
    request_id,
    organization_id,
    plugin_key,
    environment,
    enabled,
    target_version,
    expected_enabled,
    expected_version,
    actor_id
  ) VALUES (
    p_request_id,
    p_organization_id,
    p_plugin_key,
    p_environment,
    p_enabled,
    p_target_version,
    p_expected_enabled,
    p_expected_version,
    p_actor_id
  )
  ON CONFLICT (request_id) DO NOTHING;

  SELECT transitions.*
  INTO STRICT v_transition
  FROM private.plugin_application_runtime_transitions AS transitions
  WHERE transitions.request_id = p_request_id
  FOR UPDATE;

  IF v_transition.organization_id <> p_organization_id
    OR v_transition.plugin_key <> p_plugin_key
    OR v_transition.environment <> p_environment
    OR v_transition.enabled <> p_enabled
    OR v_transition.target_version IS DISTINCT FROM p_target_version
    OR v_transition.expected_enabled <> p_expected_enabled
    OR v_transition.expected_version IS DISTINCT FROM p_expected_version
    OR v_transition.actor_id <> p_actor_id
  THEN
    RAISE EXCEPTION 'application runtime request ID was reused with different inputs'
      USING errcode = '22023';
  END IF;

  IF v_transition.completed_at IS NOT NULL THEN
    RETURN v_transition.outcome;
  END IF;

  SELECT installs.id, installs.enabled, installs.desired_version
  INTO v_install
  FROM public.organization_plugin_installs AS installs
  WHERE installs.organization_id = p_organization_id
    AND installs.plugin_key = p_plugin_key
  FOR UPDATE;

  SELECT flags.enabled, flags.metadata
  INTO v_flag
  FROM public.organization_plugin_feature_flags AS flags
  WHERE flags.organization_id = p_organization_id
    AND flags.plugin_key = p_plugin_key
    AND flags.flag_key = 'application-runtime'
  FOR UPDATE;

  v_actual_enabled := v_install.id IS NOT NULL
    AND coalesce(v_install.enabled, false)
    AND coalesce(v_flag.enabled, false)
    AND v_install.desired_version IS NOT NULL
    AND v_flag.metadata ->> 'runtimeVersion' = v_install.desired_version;
  v_actual_version := CASE
    WHEN v_actual_enabled THEN v_install.desired_version
    ELSE NULL
  END;

  IF v_actual_enabled IS DISTINCT FROM p_expected_enabled
    OR v_actual_version IS DISTINCT FROM p_expected_version
  THEN
    RAISE EXCEPTION 'application runtime changed since this request was prepared'
      USING errcode = '40001';
  END IF;

  v_outcome := private.set_plugin_application_runtime_compatibility_20260822(
    p_organization_id,
    p_plugin_key,
    p_target_version,
    p_environment,
    p_enabled,
    p_actor_id,
    p_request_id
  );

  UPDATE private.plugin_application_runtime_transitions
  SET outcome = v_outcome,
    completed_at = now()
  WHERE request_id = p_request_id;

  RETURN v_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plugin_application_runtime(uuid, text, text, text, boolean, uuid, uuid, boolean, text)
  TO service_role;

COMMIT;
