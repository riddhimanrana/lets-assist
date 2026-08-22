-- A deployment identifier names one permanent Vercel origin. Historical pages
-- may keep loading assets after every organization selects a newer deployment,
-- so an origin cannot become mutable when the last active selection moves.

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
  THEN
    RAISE EXCEPTION 'plugin deployment URL cannot change after it is recorded'
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

COMMENT ON FUNCTION public.report_plugin_deployment_health(text, text, text, text, text, jsonb) IS
  'Records terminal deployment health while permanently binding each application deployment identifier to its first reported Vercel origin.';
