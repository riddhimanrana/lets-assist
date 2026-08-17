-- Prevent an active, open-ended staff position from a prior school year from
-- granting authority in the configured current CSF term.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_has_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
      AND (
        member.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM plugin_data.csf_staff_positions AS position
          JOIN plugin_data.csf_role_permissions AS permission
            ON permission.organization_id = position.organization_id
           AND permission.role_id = position.role_id
           AND permission.permission_key = p_permission_key
           AND permission.enabled = true
          JOIN plugin_data.csf_terms AS current_term
            ON current_term.organization_id = position.organization_id
           AND current_term.school_year = position.school_year
           AND current_term.is_current = true
          WHERE position.organization_id = p_organization_id
            AND position.user_id = p_actor_user_id
            AND position.status = 'active'
            AND (
              position.starts_at IS NULL
              OR position.starts_at <= plugin_data.csf_chapter_today()
            )
            AND (
              position.ends_at IS NULL
              OR position.ends_at >= plugin_data.csf_chapter_today()
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_actor(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_permission text := plugin_data.csf_import_source_permission(p_source_type);
  v_compatibility text[] := plugin_data.csf_import_compatibility_permissions(p_source_type);
  v_today date := plugin_data.csf_chapter_today();
  v_is_member boolean;
  v_is_admin boolean;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A CSF import action requires an organization and an acting officer.'
      USING ERRCODE = '42501';
  END IF;
  IF v_permission IS NULL THEN
    RAISE EXCEPTION 'CSF source type "%" is not an importable source.', coalesce(p_source_type, '<null>')
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS actor WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'The acting officer for this CSF import is not a known user.'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_type = 'meeting_attendance' THEN
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'import_meetings'
    );
    PERFORM plugin_data.csf_assert_meeting_permission_under_lock(
      p_organization_id, p_actor_user_id, 'reconcile_meeting_attendance'
    );
  END IF;

  SELECT count(*) > 0, bool_or(member.role = 'admin')
  INTO v_is_member, v_is_admin
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND coalesce(member.status, 'active') = 'active';

  IF NOT coalesce(v_is_member, false) THEN
    RAISE EXCEPTION
      'This officer is not an active member of the organization whose CSF import they are acting on.'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_admin, false) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'organization_admin'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_roles AS role
      ON role.id = position.role_id
     AND role.organization_id = position.organization_id
    JOIN plugin_data.csf_terms AS current_term
      ON current_term.organization_id = position.organization_id
     AND current_term.school_year = position.school_year
     AND current_term.is_current = true
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
      AND (role.role_type = 'owner' OR role.key = 'owner')
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'owner_position'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_staff_positions AS position
    JOIN plugin_data.csf_role_permissions AS permission
      ON permission.organization_id = position.organization_id
     AND permission.role_id = position.role_id
     AND permission.enabled = true
     AND (
       permission.permission_key = v_permission
       OR permission.permission_key = ANY (v_compatibility)
     )
    JOIN plugin_data.csf_terms AS current_term
      ON current_term.organization_id = position.organization_id
     AND current_term.school_year = position.school_year
     AND current_term.is_current = true
    WHERE position.organization_id = p_organization_id
      AND position.user_id = p_actor_user_id
      AND position.status = 'active'
      AND (position.starts_at IS NULL OR position.starts_at <= v_today)
      AND (position.ends_at IS NULL OR position.ends_at >= v_today)
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'actorUserId', p_actor_user_id,
      'sourceType', p_source_type,
      'permission', v_permission,
      'basis', 'staff_position'
    );
  END IF;

  RAISE EXCEPTION
    'This officer does not hold the % capability for CSF % imports in this organization.',
    v_permission, p_source_type
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_actor_has_permission(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_has_permission(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_actor_has_permission(uuid, uuid, text) IS
  'Service-only tenant permission predicate. Organization admins remain authoritative; staff positions must be active, in-date, and belong to the configured current term school year.';
COMMENT ON FUNCTION plugin_data.csf_assert_import_actor(uuid, uuid, text) IS
  'Owner-internal import authorization. Non-admin staff and owner positions must be active, in-date, and belong to the configured current term school year.';

NOTIFY pgrst, 'reload schema';

COMMIT;
