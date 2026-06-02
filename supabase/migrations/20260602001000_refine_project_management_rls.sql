-- Refine is_project_organizer to prioritize the creator's intent for organization-level projects.
-- This fix ensures that organization admins/staff only have management permissions 
-- for projects that are explicitly associated with their organization AND 
-- have the can_be_managed_by_staff flag enabled.
CREATE OR REPLACE FUNCTION "public"."is_project_organizer"("p_project_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select coalesce(
    p_user is not null
    and exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and (
          -- The creator always has management permissions
          p.creator_id = p_user
          or (
            -- Organization admins/staff ONLY have permissions if:
            -- 1. The project is associated with their organization
            -- 2. AND the project creator has enabled 'can_be_managed_by_staff'
            p.organization_id is not null
            and p.can_be_managed_by_staff = true
            and exists (
              select 1
              from public.organization_members om
              where om.organization_id = p.organization_id
                and om.user_id = p_user
                and om.role in ('admin', 'staff')
            )
          )
        )
    ),
    false
  );
$$;

-- Update projects RLS to allow organization admins/staff to update projects they manage
-- Previously, only the creator could update the project.
DROP POLICY IF EXISTS "Enable project creators to update their projects" ON "public"."projects";
CREATE POLICY "Enable project managers to update projects" ON "public"."projects" 
    FOR UPDATE 
    TO "authenticated"
    USING (public.is_project_organizer("id", auth.uid())) 
    WITH CHECK (
        public.is_project_organizer("id", auth.uid()) 
        AND (
            ("visibility" <> 'public'::text) 
            OR public.can_keep_or_set_public_visibility("id", auth.uid())
        )
    );

-- Update projects RLS to allow organization admins/staff to delete projects they manage
DROP POLICY IF EXISTS "Enable project creators to delete their projects" ON "public"."projects";
CREATE POLICY "Enable project managers to delete projects" ON "public"."projects" 
    FOR DELETE 
    TO "authenticated"
    USING (public.is_project_organizer("id", auth.uid()));
