-- Keep an already-rendered application asset graph on its exact deployment
-- while rechecking current caller and organization access on every request.

BEGIN;

ALTER TABLE public.plugin_versions
  DROP CONSTRAINT plugin_versions_signer_identity_check;
ALTER TABLE public.plugin_versions
  ADD CONSTRAINT plugin_versions_signer_identity_check
  CHECK (
    signer_identity IS NULL
    OR (
      jsonb_typeof(signer_identity) = 'object'
      AND signer_identity ?& ARRAY['identity', 'issuer', 'attestationRef']
      AND coalesce(jsonb_typeof(signer_identity -> 'identity') = 'string', false)
      AND length(signer_identity ->> 'identity') > 0
      AND coalesce(jsonb_typeof(signer_identity -> 'issuer') = 'string', false)
      AND length(signer_identity ->> 'issuer') > 0
      AND coalesce(jsonb_typeof(signer_identity -> 'attestationRef') = 'string', false)
      AND length(signer_identity ->> 'attestationRef') > 0
    )
  ),
  ADD CONSTRAINT plugin_versions_signed_runtime_identity_check
  CHECK (
    runtime_profile NOT IN ('application', 'service')
    OR status NOT IN ('published', 'deprecated', 'revoked')
    OR (
      coalesce(
        signer_identity ->> 'issuer' = 'https://token.actions.githubusercontent.com',
        false
      )
      AND coalesce(signer_identity ->> 'identity' =
        'https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/'
        || plugin_key || '/v' || version, false)
      AND coalesce(signer_identity ->> 'attestationRef' =
        'github-release:' || plugin_key || '/v' || version
        || '/release-manifest.sigstore.json', false)
    )
  );

CREATE OR REPLACE FUNCTION private.require_plugin_release_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('published', 'deprecated', 'revoked')
    AND (
      TG_OP = 'INSERT'
      OR OLD.status NOT IN ('published', 'deprecated', 'revoked')
    )
  THEN
    IF NEW.commit_sha IS NULL
      OR NEW.manifest_hash IS NULL
      OR NEW.source_tree IS NULL
      OR NEW.content_digest IS NULL
      OR NEW.release_inputs IS NULL
      OR NEW.host_api_range IS NULL
      OR NEW.plugin_data_schema_version IS NULL
      OR NEW.required_platform_schema_version IS NULL
      OR NEW.supported_install_contracts IS NULL
      OR NEW.runtime_profile IS NULL
      OR NEW.published_at IS NULL
    THEN
      RAISE EXCEPTION 'new published plugin releases require complete release identity';
    END IF;

    IF NEW.runtime_profile IN ('application', 'service')
      AND (
        NEW.build_digest IS NULL
        OR NEW.sbom_digest IS NULL
        OR NEW.signer_identity IS NULL
      )
    THEN
      RAISE EXCEPTION 'independently deployed plugin releases require signed build and SBOM evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION private.require_plugin_release_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.require_plugin_release_identity()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.require_plugin_release_identity()
  TO postgres;

DROP TRIGGER IF EXISTS plugin_versions_require_release_identity
  ON public.plugin_versions;
CREATE TRIGGER plugin_versions_require_release_identity
BEFORE INSERT OR UPDATE OF status, signer_identity, runtime_profile
ON public.plugin_versions
FOR EACH ROW
EXECUTE FUNCTION private.require_plugin_release_identity();

CREATE FUNCTION private.prevent_plugin_deployment_identity_rebind_20260822()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.plugin_key IS DISTINCT FROM OLD.plugin_key
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.deployment_id IS DISTINCT FROM OLD.deployment_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.runtime_profile IS DISTINCT FROM OLD.runtime_profile
  THEN
    RAISE EXCEPTION 'plugin deployment identity cannot change'
      USING errcode = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.prevent_plugin_deployment_identity_rebind_20260822()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_plugin_deployment_identity_rebind_20260822()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.prevent_plugin_deployment_identity_rebind_20260822()
  TO postgres;

CREATE TRIGGER plugin_deployments_prevent_identity_rebind
BEFORE UPDATE ON private.plugin_deployments
FOR EACH ROW
EXECUTE FUNCTION private.prevent_plugin_deployment_identity_rebind_20260822();

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
  IF p_health_status = 'healthy'
    AND v_deployment.runtime_profile = 'application'
    AND (
      v_reported_url IS NULL
      OR v_reported_url !~ '^https://[a-z0-9][a-z0-9.-]*\.vercel\.app/?$'
      OR position('..' in v_reported_url) > 0
    )
  THEN
    RAISE EXCEPTION 'a healthy application deployment requires a canonical Vercel URL'
      USING errcode = '22023';
  END IF;

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

ALTER FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb)
  TO postgres, service_role;

CREATE FUNCTION public.get_plugin_application_asset_route_target_by_identifier(
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
  v_actor_id uuid := (SELECT auth.uid());
  v_organization_id uuid;
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
    OR p_deployment_id IS NULL
    OR char_length(p_deployment_id) NOT BETWEEN 5 AND 200
    OR p_deployment_id !~ '^dpl_[A-Za-z0-9_]+$'
  THEN
    RAISE EXCEPTION 'valid plugin application asset coordinates are required'
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
    RAISE EXCEPTION 'valid plugin application asset coordinates are required'
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

  SELECT deployments.*
  INTO v_deployment
  FROM private.plugin_deployments AS deployments
  WHERE deployments.plugin_key = p_plugin_key
    AND deployments.environment = p_environment
    AND deployments.runtime_profile = 'application'
    AND deployments.deployment_id = p_deployment_id
    AND deployments.health_status = 'healthy'
    AND deployments.promotion_status IN ('deployed', 'promoted')
  LIMIT 1;

  IF v_deployment.id IS NULL THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  -- Asset skew may outlive the organization's currently selected application
  -- version. Recheck the current catalog, entitlement, enabled install,
  -- compatibility, and force-update floor without requiring this historical
  -- release to remain the selected page runtime.
  v_access := private.get_plugin_application_access_context_unhardened_20260822(
    v_organization_id,
    p_plugin_key,
    v_deployment.version
  );
  IF NOT coalesce((v_access ->> 'accessible')::boolean, false) THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  v_deployment_url := v_deployment.health_evidence ->> 'deploymentUrl';
  IF v_deployment_url IS NULL
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
    'runtimeVersion', v_deployment.version,
    'deploymentId', v_deployment.deployment_id,
    'deploymentUrl', rtrim(v_deployment_url, '/')
  );
END;
$$;

ALTER FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  TO postgres, authenticated;

COMMENT ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text) IS
  'Returns one exact healthy deployment for an authenticated member asset request while rechecking the historical release against current organization access.';

COMMIT;
