-- Revalidate and serialize organization-admin authority inside the same
-- transaction that records or replays an application-runtime transition.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_plugin_application_runtime(
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

  PERFORM 1
  FROM public.organization_members AS members
  WHERE members.organization_id = p_organization_id
    AND members.user_id = p_actor_id
    AND members.role = 'admin'
    AND members.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active organization admin is required' USING errcode = '42501';
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

REVOKE ALL ON FUNCTION public.set_plugin_application_runtime(
  uuid, text, text, text, boolean, uuid, uuid, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_plugin_application_runtime(
  uuid, text, text, text, boolean, uuid, uuid, boolean, text
) TO service_role;

COMMENT ON FUNCTION public.set_plugin_application_runtime(
  uuid, text, text, text, boolean, uuid, uuid, boolean, text
) IS
  'Applies or replays one application-runtime transition after locking and revalidating the active organization-admin actor.';

COMMIT;
