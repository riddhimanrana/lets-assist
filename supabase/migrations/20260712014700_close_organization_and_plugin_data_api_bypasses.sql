-- Expose only non-capability organization columns through the base table. The
-- public read model remains the preferred discovery surface.
REVOKE SELECT ON TABLE public.organizations FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  username,
  description,
  website,
  logo_url,
  type,
  verified,
  created_at,
  allowed_email_domains,
  show_members_publicly
) ON TABLE public.organizations TO anon, authenticated;

-- Join codes are bearer capabilities. A duplicate would make the service-only
-- join RPC ambiguous (and could be used to deny joins for another org).
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_join_code_format_check
  CHECK (join_code ~ '^[0-9]{6}$');
CREATE UNIQUE INDEX organizations_join_code_unique_idx
  ON public.organizations (join_code);

-- Keep the database contract aligned with the create/settings schemas.
ALTER TABLE public.organizations
  DROP CONSTRAINT organizations_type_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_type_check
  CHECK (type = ANY (ARRAY['nonprofit', 'school', 'company', 'government', 'other']));

CREATE OR REPLACE FUNCTION private.can_current_user_create_organization()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_super_admin boolean := false;
  v_recent_count integer;
  v_limit integer;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_trusted_member(v_user_id) THEN
    RETURN false;
  END IF;

  -- Serialize the cooldown count so parallel client requests cannot each pass
  -- the same pre-insert snapshot.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('lets-assist-org-create:' || v_user_id::text, 0)
  );

  SELECT coalesce(
    users.raw_app_meta_data -> 'is_super_admin' = 'true'::jsonb,
    false
  )
  INTO v_is_super_admin
  FROM auth.users AS users
  WHERE users.id = v_user_id;

  v_limit := CASE WHEN v_is_super_admin THEN 2 ELSE 1 END;

  SELECT count(*)::integer
  INTO v_recent_count
  FROM public.organizations AS organizations
  WHERE organizations.created_by = v_user_id
    AND organizations.created_at > now() - interval '14 days';

  RETURN v_recent_count < v_limit;
END;
$$;

REVOKE ALL ON FUNCTION private.can_current_user_create_organization()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_current_user_create_organization()
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Create org with cooldown" ON public.organizations;
CREATE POLICY "Create org with serialized cooldown"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND private.can_current_user_create_organization()
  );

-- Joining an organization is a capability flow, never an arbitrary client
-- insert. Existing staff/domain/invitation paths already use server clients.
DROP POLICY IF EXISTS "Manage member inserts" ON public.organization_members;
REVOKE INSERT ON TABLE public.organization_members FROM anon, authenticated;

-- The legacy update policy recursively selected organization_members from an
-- organization_members policy, so ordinary role changes failed with 42P17.
-- SECURITY DEFINER membership helpers provide the same authorization without
-- recursive RLS evaluation.
DROP POLICY IF EXISTS "Manage member updates" ON public.organization_members;
CREATE POLICY "Organization member roles manageable by admins and staff"
  ON public.organization_members
  FOR UPDATE
  TO authenticated
  USING (
    private.is_org_admin(organization_id)
    OR (
      private.get_user_org_role(organization_id) = 'staff'
      AND role <> 'admin'
    )
  )
  WITH CHECK (
    private.is_org_admin(organization_id)
    OR (
      private.get_user_org_role(organization_id) = 'staff'
      AND role <> 'admin'
    )
  );

-- Plugin install state must pass the leased lifecycle control plane.
DROP POLICY IF EXISTS "Plugin installs insert by org admins and staff"
  ON public.organization_plugin_installs;
DROP POLICY IF EXISTS "Plugin installs update by org admins and staff"
  ON public.organization_plugin_installs;
DROP POLICY IF EXISTS "Plugin installs delete by org admins and staff"
  ON public.organization_plugin_installs;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_plugin_installs
  FROM anon, authenticated;

-- Entitlements and feature flags participate in the same access decision.
-- They must not provide a second, client-writable control plane beside the
-- leased lifecycle transition service.
DROP POLICY IF EXISTS "Feature flags insert by org admins"
  ON public.organization_plugin_feature_flags;
DROP POLICY IF EXISTS "Feature flags update by org admins"
  ON public.organization_plugin_feature_flags;
DROP POLICY IF EXISTS "Feature flags delete by org admins"
  ON public.organization_plugin_feature_flags;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.organization_plugin_entitlements,
           public.organization_plugin_feature_flags
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.protect_organization_capability_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF TG_OP = 'INSERT' AND (
      coalesce(NEW.verified, false)
      OR NEW.auto_join_domain IS NOT NULL
      OR NEW.created_by IS DISTINCT FROM auth.uid()
      OR NEW.staff_join_token IS NOT NULL
      OR NEW.staff_join_token_created_at IS NOT NULL
      OR NEW.staff_join_token_expires_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'organization trust fields require a server-authorized operation'
        USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' AND (
      NEW.verified IS DISTINCT FROM OLD.verified
      OR NEW.auto_join_domain IS DISTINCT FROM OLD.auto_join_domain
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.join_code IS DISTINCT FROM OLD.join_code
      OR NEW.staff_join_token IS DISTINCT FROM OLD.staff_join_token
      OR NEW.staff_join_token_created_at IS DISTINCT FROM OLD.staff_join_token_created_at
      OR NEW.staff_join_token_expires_at IS DISTINCT FROM OLD.staff_join_token_expires_at
    ) THEN
      RAISE EXCEPTION 'organization capability fields require a server-authorized operation'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_organization_capability_columns
  ON public.organizations;
CREATE TRIGGER protect_organization_capability_columns
BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION private.protect_organization_capability_columns();

CREATE OR REPLACE FUNCTION private.protect_organization_membership_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'organization membership identity is immutable'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.role = 'admin' AND NEW.role <> 'admin' THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          'lets-assist-org-membership:' || OLD.organization_id::text,
          0
        )
      );

      IF NOT EXISTS (
        SELECT 1
        FROM public.organization_members AS memberships
        WHERE memberships.organization_id = OLD.organization_id
          AND memberships.id <> OLD.id
          AND memberships.role = 'admin'
      ) THEN
        RAISE EXCEPTION 'cannot demote the final organization admin'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_organization_membership_identity
  ON public.organization_members;
CREATE TRIGGER protect_organization_membership_identity
BEFORE UPDATE ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION private.protect_organization_membership_identity();

CREATE OR REPLACE FUNCTION private.protect_project_ownership_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
    AND (
      NEW.creator_id IS DISTINCT FROM OLD.creator_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    )
  THEN
    RAISE EXCEPTION 'project ownership and organization association are immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_project_ownership_columns ON public.projects;
CREATE TRIGGER protect_project_ownership_columns
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION private.protect_project_ownership_columns();

REVOKE ALL ON FUNCTION private.protect_organization_capability_columns()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.protect_organization_membership_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.protect_project_ownership_columns()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_organization_with_code(
  p_user_id uuid,
  p_join_code text
)
RETURNS TABLE (
  organization_id uuid,
  organization_username text,
  join_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_inserted_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_join_code !~ '^[0-9]{6}$' THEN
    RETURN;
  END IF;

  SELECT organizations.*
  INTO v_organization
  FROM public.organizations AS organizations
  WHERE organizations.join_code = p_join_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lets-assist-org-membership:' || v_organization.id::text,
      0
    )
  );

  DELETE FROM public.organization_autojoin_suppressions AS suppressions
  WHERE suppressions.organization_id = v_organization.id
    AND suppressions.user_id = p_user_id;

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

  organization_id := v_organization.id;
  organization_username := v_organization.username;
  join_status := CASE WHEN v_inserted_id IS NULL THEN 'already_member' ELSE 'joined' END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.join_organization_with_code(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_organization_with_code(uuid, text)
  TO service_role;
