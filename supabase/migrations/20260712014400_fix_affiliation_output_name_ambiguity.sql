-- Re-declare the function after replacing the ambiguous ON CONFLICT column
-- target with its named unique constraint. Output column names in a PL/pgSQL
-- TABLE function are variables and otherwise collide with organization_id.
CREATE OR REPLACE FUNCTION public.apply_verified_domain_affiliation(
  p_user_id uuid,
  p_domain text
)
RETURNS TABLE (
  status text,
  organization_id uuid,
  organization_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_inserted_id uuid;
BEGIN
  SELECT organizations.*
  INTO v_organization
  FROM public.organizations AS organizations
  WHERE organizations.auto_join_domain = lower(btrim(p_domain))
    AND organizations.verified = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-org-membership:' || v_organization.id::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.organization_autojoin_suppressions AS suppressions
    WHERE suppressions.organization_id = v_organization.id
      AND suppressions.user_id = p_user_id
  ) THEN
    RETURN QUERY
    SELECT 'suppressed'::text, v_organization.id, v_organization.name::text;
    RETURN;
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    role,
    joined_at
  )
  VALUES (v_organization.id, p_user_id, 'member', now())
  ON CONFLICT ON CONSTRAINT organization_members_organization_id_user_id_key
    DO NOTHING
  RETURNING id INTO v_inserted_id;

  RETURN QUERY
  SELECT
    CASE WHEN v_inserted_id IS NULL THEN 'already_member' ELSE 'joined' END,
    v_organization.id,
    v_organization.name::text;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_verified_domain_affiliation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_domain_affiliation(uuid, text)
  TO service_role;
