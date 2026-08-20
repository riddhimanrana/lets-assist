-- Add deployment observations and durable plugin update operations without
-- changing runtime activation behavior. Health remains evidence recorded by a
-- separate workflow path. The activation gate will land only after hosted
-- Development proves that reporter end to end.

BEGIN;

CREATE TABLE private.plugin_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_key text NOT NULL REFERENCES public.plugins(key) ON DELETE CASCADE,
  version text NOT NULL,
  environment text NOT NULL
    CHECK (environment IN ('local', 'preview', 'development', 'production')),
  runtime_profile text NOT NULL
    CHECK (runtime_profile IN ('embedded', 'application', 'service')),
  deployment_id text NOT NULL CHECK (length(btrim(deployment_id)) > 0),
  host_commit_sha text
    CHECK (host_commit_sha IS NULL OR host_commit_sha ~ '^[0-9a-f]{40}$'),
  health_status text NOT NULL DEFAULT 'pending'
    CHECK (health_status IN ('pending', 'healthy', 'unhealthy', 'unknown')),
  promotion_status text NOT NULL DEFAULT 'deployed'
    CHECK (promotion_status IN ('deployed', 'promoted', 'rolled_back', 'retired')),
  runtime_contracts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(runtime_contracts) = 'object'),
  health_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(health_evidence) = 'object'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  health_reported_at timestamptz,
  UNIQUE (plugin_key, environment, deployment_id),
  FOREIGN KEY (plugin_key, version)
    REFERENCES public.plugin_versions(plugin_key, version)
);

COMMENT ON TABLE private.plugin_deployments IS
  'Observed plugin deployments. Process boot records pending presence; a separate deployment workflow records health evidence.';
COMMENT ON COLUMN private.plugin_deployments.deployment_id IS
  'Provider deployment identity. A semantic version may have many deployments.';
COMMENT ON COLUMN private.plugin_deployments.health_status IS
  'Pending at first observation. Healthy requires a separate accepted deployment report.';

CREATE INDEX plugin_deployments_release_environment_idx
  ON private.plugin_deployments (plugin_key, version, environment);

CREATE OR REPLACE FUNCTION public.observe_plugin_deployment(
  p_plugin_key text,
  p_version text,
  p_environment text,
  p_runtime_profile text,
  p_deployment_id text,
  p_host_commit_sha text DEFAULT NULL,
  p_runtime_contracts jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deployment_id uuid;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  IF p_runtime_contracts IS NULL OR jsonb_typeof(p_runtime_contracts) <> 'object' THEN
    RAISE EXCEPTION 'runtime contracts must be an object' USING errcode = '22023';
  END IF;

  INSERT INTO private.plugin_deployments (
    plugin_key,
    version,
    environment,
    runtime_profile,
    deployment_id,
    host_commit_sha,
    runtime_contracts,
    health_status,
    promotion_status
  ) VALUES (
    p_plugin_key,
    p_version,
    p_environment,
    p_runtime_profile,
    p_deployment_id,
    p_host_commit_sha,
    p_runtime_contracts,
    'pending',
    'deployed'
  )
  ON CONFLICT (plugin_key, environment, deployment_id) DO UPDATE
  SET
    version = EXCLUDED.version,
    runtime_profile = EXCLUDED.runtime_profile,
    host_commit_sha = EXCLUDED.host_commit_sha,
    runtime_contracts = EXCLUDED.runtime_contracts,
    last_seen_at = now()
  RETURNING id INTO v_deployment_id;

  RETURN v_deployment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.observe_plugin_deployment(text, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_plugin_deployment(text, text, text, text, text, text, jsonb)
  TO service_role;

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

  UPDATE private.plugin_deployments
  SET
    health_status = p_health_status,
    promotion_status = p_promotion_status,
    health_evidence = p_health_evidence,
    health_reported_at = now(),
    last_seen_at = now()
  WHERE plugin_key = p_plugin_key
    AND environment = p_environment
    AND deployment_id = p_deployment_id;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  TO service_role;

ALTER TABLE public.organization_plugin_installs
  ADD COLUMN desired_version text,
  ADD COLUMN update_policy text NOT NULL DEFAULT 'manual';

ALTER TABLE public.organization_plugin_installs
  ADD CONSTRAINT organization_plugin_installs_update_policy_check
    CHECK (update_policy IN ('manual', 'security_only')),
  ADD CONSTRAINT organization_plugin_installs_desired_release_fkey
    FOREIGN KEY (plugin_key, desired_version)
    REFERENCES public.plugin_versions(plugin_key, version);

COMMENT ON COLUMN public.organization_plugin_installs.desired_version IS
  'Operator-selected target release. It does not imply that code is deployed or activated.';
COMMENT ON COLUMN public.organization_plugin_installs.update_policy IS
  'Manual by default. security_only permits only a separately reviewed security release path.';
COMMENT ON COLUMN public.organization_plugin_installs.auto_update IS
  'Legacy compatibility field. Frozen false; use update_policy for reviewed future behavior.';

ALTER TABLE public.organization_plugin_installs
  ADD CONSTRAINT organization_plugin_installs_legacy_auto_update_false
    CHECK (auto_update = false) NOT VALID;
ALTER TABLE public.organization_plugin_installs
  VALIDATE CONSTRAINT organization_plugin_installs_legacy_auto_update_false;

CREATE TABLE private.plugin_update_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  plugin_key text NOT NULL
    REFERENCES public.plugins(key) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  lock_token uuid NOT NULL,
  actor_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  from_version text,
  target_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(preflight) = 'object'),
  outcome jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(outcome) = 'object'),
  redacted_error text CHECK (redacted_error IS NULL OR length(redacted_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, plugin_key, idempotency_key),
  FOREIGN KEY (plugin_key, target_version)
    REFERENCES public.plugin_versions(plugin_key, version)
);

COMMENT ON TABLE private.plugin_update_operations IS
  'Idempotent update attempts linked to the live control-plane lease. Error text must be redacted before persistence.';

CREATE INDEX plugin_update_operations_pending_idx
  ON private.plugin_update_operations (organization_id, plugin_key, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.begin_plugin_update_operation(
  p_organization_id uuid,
  p_plugin_key text,
  p_idempotency_key text,
  p_lock_token uuid,
  p_actor_id uuid,
  p_actor_type text,
  p_from_version text,
  p_target_version text,
  p_preflight jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation private.plugin_update_operations%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  IF p_preflight IS NULL OR jsonb_typeof(p_preflight) <> 'object' THEN
    RAISE EXCEPTION 'preflight must be an object' USING errcode = '22023';
  END IF;

  PERFORM 1
  FROM private.plugin_control_plane_transition_locks AS locks
  WHERE locks.organization_id = p_organization_id
    AND locks.plugin_key = p_plugin_key
    AND locks.lock_token = p_lock_token
    AND locks.expires_at > now()
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'a live matching plugin transition lease is required'
      USING errcode = '40001';
  END IF;

  PERFORM 1
  FROM public.plugin_versions AS releases
  WHERE releases.plugin_key = p_plugin_key
    AND releases.version = p_target_version
    AND releases.status = 'published';

  IF NOT found THEN
    RAISE EXCEPTION 'plugin update target must be a published release'
      USING errcode = '22023';
  END IF;

  INSERT INTO private.plugin_update_operations (
    organization_id,
    plugin_key,
    idempotency_key,
    lock_token,
    actor_id,
    actor_type,
    from_version,
    target_version,
    preflight
  ) VALUES (
    p_organization_id,
    p_plugin_key,
    p_idempotency_key,
    p_lock_token,
    p_actor_id,
    p_actor_type,
    p_from_version,
    p_target_version,
    p_preflight
  )
  ON CONFLICT (organization_id, plugin_key, idempotency_key) DO NOTHING;

  SELECT operations.*
  INTO STRICT v_operation
  FROM private.plugin_update_operations AS operations
  WHERE operations.organization_id = p_organization_id
    AND operations.plugin_key = p_plugin_key
    AND operations.idempotency_key = p_idempotency_key;

  IF v_operation.lock_token <> p_lock_token
    OR v_operation.target_version <> p_target_version
    OR v_operation.from_version IS DISTINCT FROM p_from_version
    OR v_operation.actor_type <> p_actor_type
    OR v_operation.actor_id IS DISTINCT FROM p_actor_id
    OR v_operation.preflight IS DISTINCT FROM p_preflight
  THEN
    RAISE EXCEPTION 'idempotency key was reused with different update inputs'
      USING errcode = '22023';
  END IF;

  RETURN jsonb_build_object(
    'id', v_operation.id,
    'status', v_operation.status,
    'createdAt', v_operation.created_at,
    'completedAt', v_operation.completed_at,
    'outcome', v_operation.outcome,
    'redactedError', v_operation.redacted_error
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_plugin_update_operation(uuid, text, text, uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_plugin_update_operation(uuid, text, text, uuid, uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_plugin_update_operation(
  p_operation_id uuid,
  p_lock_token uuid,
  p_status text,
  p_outcome jsonb DEFAULT '{}'::jsonb,
  p_redacted_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operation private.plugin_update_operations%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING errcode = '42501';
  END IF;

  IF p_status NOT IN ('succeeded', 'failed')
    OR p_outcome IS NULL
    OR jsonb_typeof(p_outcome) <> 'object'
    OR (p_status = 'succeeded' AND p_redacted_error IS NOT NULL)
    OR (p_redacted_error IS NOT NULL AND length(p_redacted_error) > 2000)
  THEN
    RAISE EXCEPTION 'invalid plugin update completion' USING errcode = '22023';
  END IF;

  SELECT operations.*
  INTO v_operation
  FROM private.plugin_update_operations AS operations
  WHERE operations.id = p_operation_id
    AND operations.lock_token = p_lock_token
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'plugin update operation does not match the lease token'
      USING errcode = '40001';
  END IF;

  IF v_operation.status = 'pending' THEN
    PERFORM 1
    FROM private.plugin_control_plane_transition_locks AS locks
    WHERE locks.organization_id = v_operation.organization_id
      AND locks.plugin_key = v_operation.plugin_key
      AND locks.lock_token = p_lock_token
      AND locks.expires_at > now();

    IF NOT found THEN
      RAISE EXCEPTION 'a live matching plugin transition lease is required'
        USING errcode = '40001';
    END IF;

    UPDATE private.plugin_update_operations
    SET
      status = p_status,
      outcome = p_outcome,
      redacted_error = p_redacted_error,
      completed_at = now()
    WHERE id = p_operation_id
    RETURNING * INTO v_operation;
  ELSIF v_operation.status <> p_status
    OR v_operation.outcome IS DISTINCT FROM p_outcome
    OR v_operation.redacted_error IS DISTINCT FROM p_redacted_error
  THEN
    RAISE EXCEPTION 'completed update operation cannot be changed'
      USING errcode = '22023';
  END IF;

  RETURN jsonb_build_object(
    'id', v_operation.id,
    'status', v_operation.status,
    'completedAt', v_operation.completed_at,
    'outcome', v_operation.outcome,
    'redactedError', v_operation.redacted_error
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_plugin_update_operation(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_plugin_update_operation(uuid, uuid, text, jsonb, text)
  TO service_role;

COMMIT;
