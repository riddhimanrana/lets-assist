-- Keep privileged policy helpers out of PostgREST's exposed schemas.
-- Public callers retain only SECURITY INVOKER wrappers that bind user-scoped
-- arguments to auth.uid(); the trigger implementation has no client grant.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;

ALTER FUNCTION public.can_insert_project(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.can_insert_project(uuid, text, uuid) SET SCHEMA app_private;
ALTER FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) SET SCHEMA app_private;
ALTER FUNCTION public.get_public_attendees(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.handle_new_user() SET SCHEMA app_private;
ALTER FUNCTION public.is_project_organizer(uuid, uuid) SET SCHEMA app_private;
ALTER FUNCTION public.is_trusted_member(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.can_insert_project(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.can_insert_project(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.can_keep_or_set_public_visibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.get_public_attendees(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.is_project_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.is_trusted_member(uuid) FROM PUBLIC, anon, authenticated;

-- Existing RLS policies retain their OID-bound references after SET SCHEMA and
-- therefore require only the same narrow authenticated execution grants.
GRANT EXECUTE ON FUNCTION app_private.can_insert_project(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_insert_project(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_keep_or_set_public_visibility(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_project_organizer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_trusted_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_public_attendees(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.handle_new_user() TO service_role;

CREATE FUNCTION public.can_insert_project(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user IS NOT DISTINCT FROM (SELECT auth.uid())
      THEN app_private.can_insert_project(p_user)
    ELSE false
  END;
$$;

CREATE FUNCTION public.can_insert_project(
  p_user uuid,
  p_visibility text,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user IS NOT DISTINCT FROM (SELECT auth.uid())
      THEN app_private.can_insert_project(p_user, p_visibility, p_organization_id)
    ELSE false
  END;
$$;

CREATE FUNCTION public.can_keep_or_set_public_visibility(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user IS NOT DISTINCT FROM (SELECT auth.uid())
      THEN app_private.can_keep_or_set_public_visibility(p_project_id, p_user)
    ELSE false
  END;
$$;

CREATE FUNCTION public.is_project_organizer(p_project_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user IS NOT DISTINCT FROM (SELECT auth.uid())
      THEN app_private.is_project_organizer(p_project_id, p_user)
    ELSE false
  END;
$$;

CREATE FUNCTION public.is_trusted_member(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user IS NOT DISTINCT FROM (SELECT auth.uid())
      THEN app_private.is_trusted_member(p_user)
    ELSE false
  END;
$$;

CREATE FUNCTION public.get_public_attendees(p_project_id uuid)
RETURNS TABLE (
  signup_id uuid,
  schedule_id text,
  user_id uuid,
  full_name text,
  username text,
  avatar_url text,
  volunteer_comment text,
  is_anonymous boolean,
  anonymous_name text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM app_private.get_public_attendees(p_project_id);
$$;

REVOKE ALL ON FUNCTION public.can_insert_project(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_insert_project(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_project_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_trusted_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_attendees(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_organizer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_trusted_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_attendees(uuid) TO anon, authenticated, service_role;

COMMENT ON SCHEMA app_private IS
  'Non-exposed implementations for privileged policy helpers and triggers.';
COMMENT ON FUNCTION public.get_public_attendees(uuid) IS
  'Invoker boundary for the validated public attendee projection.';

COMMIT;
