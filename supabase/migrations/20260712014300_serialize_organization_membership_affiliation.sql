-- Serialize affiliation and removal per organization. Authorization and the
-- last-admin invariant live inside the same transaction as the mutation.
CREATE OR REPLACE FUNCTION public.remove_organization_member_with_autojoin_suppression(
  p_organization_id uuid,
  p_membership_id uuid,
  p_removed_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_user_id uuid;
  v_target_role text;
  v_actor_role text;
  v_admin_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-org-membership:' || p_organization_id::text, 0)
  );

  SELECT members.user_id, members.role::text
  INTO v_target_user_id, v_target_role
  FROM public.organization_members AS members
  WHERE members.id = p_membership_id
    AND members.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_removed_by IS NULL THEN
    RAISE EXCEPTION 'membership removal actor is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_removed_by <> v_target_user_id THEN
    SELECT members.role::text
    INTO v_actor_role
    FROM public.organization_members AS members
    WHERE members.organization_id = p_organization_id
      AND members.user_id = p_removed_by;

    IF v_actor_role = 'admin' THEN
      NULL;
    ELSIF v_actor_role = 'staff' AND v_target_role = 'member' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'not authorized to remove this organization member'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_target_role = 'admin' THEN
    SELECT count(*)::integer
    INTO v_admin_count
    FROM public.organization_members AS members
    WHERE members.organization_id = p_organization_id
      AND members.role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'cannot remove the final organization admin'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.organization_autojoin_suppressions (
    organization_id,
    user_id,
    removed_by
  )
  VALUES (p_organization_id, v_target_user_id, p_removed_by)
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET removed_by = EXCLUDED.removed_by,
      created_at = now();

  DELETE FROM public.organization_members
  WHERE id = p_membership_id
    AND organization_id = p_organization_id;

  RETURN FOUND;
END;
$$;

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
  ON CONFLICT ON CONSTRAINT organization_members_organization_id_user_id_key DO NOTHING
  RETURNING id INTO v_inserted_id;

  RETURN QUERY
  SELECT
    CASE WHEN v_inserted_id IS NULL THEN 'already_member' ELSE 'joined' END,
    v_organization.id,
    v_organization.name::text;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_organization_member_with_autojoin_suppression(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member_with_autojoin_suppression(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.apply_verified_domain_affiliation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_domain_affiliation(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.apply_verified_domain_affiliation(uuid, text) IS
  'Atomically applies verified-domain membership while respecting explicit-removal suppression under the same organization lock.';
