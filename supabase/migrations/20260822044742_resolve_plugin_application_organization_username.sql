-- Keep child applications behind caller-scoped RPCs while accepting the
-- organization usernames used by public product routes.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_plugin_application_access_context_by_identifier(
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
    AND p_organization_identifier COLLATE "C" ~ '^[a-z0-9_.-]+$'
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

  RETURN public.get_plugin_application_access_context(
    v_organization_id,
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
  'Caller-scoped application-plugin access proof for a canonical organization UUID or public route username. Resolves the identifier inside the database, then delegates to the reviewed UUID access gate without exposing direct child table access.';

COMMIT;
