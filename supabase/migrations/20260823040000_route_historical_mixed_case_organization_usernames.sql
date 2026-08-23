-- Preserve application routing for historical organization usernames while
-- keeping UUID resolution and access checks inside the database.

BEGIN;

ALTER FUNCTION public.get_plugin_application_access_context_by_identifier(text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_access_context_by_identifier(text, text, text)
  RENAME TO get_plugin_app_access_by_identifier_legacy_20260823;
REVOKE ALL ON FUNCTION private.get_plugin_app_access_by_identifier_legacy_20260823(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_plugin_application_access_context_by_identifier(
  p_organization_identifier text,
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
  v_organization_id uuid;
BEGIN
  IF (SELECT auth.role()) <> 'authenticated' OR (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'authenticated session is required' USING errcode = '42501';
  END IF;

  IF p_organization_identifier IS NULL
    OR p_plugin_key IS NULL
    OR p_plugin_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_runtime_version IS NULL
  THEN
    RAISE EXCEPTION 'valid plugin application coordinates are required'
      USING errcode = '22023';
  END IF;

  IF p_organization_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_organization_id := p_organization_identifier::uuid;
  ELSIF char_length(p_organization_identifier) BETWEEN 3 AND 32
    AND p_organization_identifier COLLATE "C" ~ '^[A-Za-z0-9_.-]+$'
    AND p_organization_identifier !~ '(^\.|\.$|\.\.)'
  THEN
    SELECT organizations.id
    INTO v_organization_id
    FROM public.organizations
    WHERE organizations.username = p_organization_identifier;
  ELSE
    RAISE EXCEPTION 'valid plugin application coordinates are required'
      USING errcode = '22023';
  END IF;

  IF v_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'accessible', false,
      'reason', 'membership_required'
    );
  END IF;

  RETURN private.get_plugin_app_access_by_identifier_legacy_20260823(
    v_organization_id::text,
    p_plugin_key,
    p_runtime_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_access_context_by_identifier(text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_access_context_by_identifier(text, text, text)
  TO authenticated;
COMMENT ON FUNCTION public.get_plugin_application_access_context_by_identifier(text, text, text) IS
  'Resolves canonical UUIDs and exact historical or current organization usernames before returning caller-scoped application access.';

ALTER FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_route_target_by_identifier(text, text, text)
  RENAME TO get_plugin_app_route_by_identifier_legacy_20260823;
REVOKE ALL ON FUNCTION private.get_plugin_app_route_by_identifier_legacy_20260823(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
    AND p_organization_identifier COLLATE "C" ~ '^[A-Za-z0-9_.-]+$'
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

  IF v_organization_id IS NULL THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  RETURN private.get_plugin_app_route_by_identifier_legacy_20260823(
    v_organization_id::text,
    p_plugin_key,
    p_environment
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text)
  TO authenticated;
COMMENT ON FUNCTION public.get_plugin_application_route_target_by_identifier(text, text, text) IS
  'Resolves canonical UUIDs and exact historical or current organization usernames before returning the selected healthy application deployment.';

ALTER FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  SET SCHEMA private;
ALTER FUNCTION private.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  RENAME TO get_plugin_app_asset_by_identifier_legacy_20260823;
REVOKE ALL ON FUNCTION private.get_plugin_app_asset_by_identifier_legacy_20260823(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
    AND p_organization_identifier COLLATE "C" ~ '^[A-Za-z0-9_.-]+$'
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

  IF v_organization_id IS NULL THEN
    RETURN jsonb_build_object('schemaVersion', 1, 'routable', false);
  END IF;

  RETURN private.get_plugin_app_asset_by_identifier_legacy_20260823(
    v_organization_id::text,
    p_plugin_key,
    p_environment,
    p_deployment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text)
  TO authenticated;
COMMENT ON FUNCTION public.get_plugin_application_asset_route_target_by_identifier(text, text, text, text) IS
  'Resolves canonical UUIDs and exact historical or current organization usernames before returning a pinned application asset deployment.';

COMMIT;
