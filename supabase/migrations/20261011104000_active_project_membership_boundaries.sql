-- Only an active organization membership confers project insert or read authority.
--
-- The insert helper and the authenticated SELECT policy on public.projects both
-- matched a membership row by role alone, so an inactive, suspended, or
-- null-status admin or staff member kept creating and reading organization
-- projects. Both now compare status for equality with 'active', the same rule
-- app_private.is_project_organizer already applies.

BEGIN;

-- CREATE OR REPLACE keeps the function OID, so the existing
-- "projects insert consolidated" policy and the actor-bound
-- public.can_insert_project wrapper keep calling this implementation unchanged.
CREATE OR REPLACE FUNCTION app_private.can_insert_project(
  p_user uuid,
  p_visibility text,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_count integer;
BEGIN
  IF p_user IS NULL THEN
    RETURN false;
  END IF;

  -- Keep rate limit aligned with application server actions.
  SELECT count(*)
    INTO recent_count
  FROM public.projects
  WHERE creator_id = p_user
    AND created_at > (now() - interval '24 hours');

  IF recent_count >= 50 THEN
    RETURN false;
  END IF;

  -- Public-feed projects require trusted status.
  IF coalesce(p_visibility, 'public') = 'public'
     AND NOT app_private.is_trusted_member(p_user) THEN
    RETURN false;
  END IF;

  -- Organization-affiliated projects require an active org admin/staff role.
  IF p_organization_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.organization_members AS om
       WHERE om.organization_id = p_organization_id
         AND om.user_id = p_user
         AND om.status = 'active'
         AND om.role IN ('admin', 'staff')
     ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_private.can_insert_project(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_insert_project(uuid, text, uuid)
  TO authenticated, service_role;

-- The creator, and anyone reading a published public or unlisted project, keep
-- the access they had. Organization access now requires an active membership:
-- any active member reads a published organization-only project, and an
-- unpublished one is limited to active admins and to active staff when the
-- project allows staff management.
DROP POLICY IF EXISTS "projects_select_authenticated" ON public.projects;
CREATE POLICY "projects_select_authenticated" ON public.projects
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = creator_id
    OR (
      visibility = ANY (ARRAY['public'::text, 'unlisted'::text])
      AND (workflow_status IS NULL OR workflow_status = 'published'::text)
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.organization_id = projects.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.status = 'active'
        AND (
          om.role = 'admin'
          OR (
            om.role = 'staff'
            AND projects.can_be_managed_by_staff IS TRUE
          )
          OR (
            om.role IN ('admin', 'staff', 'member')
            AND projects.visibility = 'organization_only'::text
            AND (
              projects.workflow_status IS NULL
              OR projects.workflow_status = 'published'::text
            )
          )
        )
    )
  );

COMMENT ON FUNCTION app_private.can_insert_project(uuid, text, uuid) IS
  'Project insert eligibility: rate limit, trusted public visibility, and an active organization admin or staff membership.';

COMMIT;
