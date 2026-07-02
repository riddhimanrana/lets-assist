-- First advisor-backed hardening pass.
-- Keep this migration intentionally narrow: fix confirmed lint findings that do
-- not change app-facing table grants or remove currently used RPCs.

BEGIN;

-- Fix mutable search_path findings on SECURITY DEFINER functions.
ALTER FUNCTION public.accept_organization_invitations_on_join()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.process_automatic_check_ins()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.process_automatic_check_outs()
  SET search_path = public, pg_temp;

-- Trigger/event-trigger functions should not be directly executable from
-- PostgREST/GraphQL roles. Triggers still execute as the function owner.
REVOKE EXECUTE ON FUNCTION public.accept_organization_invitations_on_join() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_automatic_check_ins() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_automatic_check_outs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_email_to_custom_table() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trusted_member_set_user_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_profile_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_project_draft_updated_at() FROM PUBLIC, anon, authenticated;

-- Public buckets can serve public object URLs without allowing object listing
-- through storage.objects SELECT policies.
DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public can read organization logos" ON storage.objects;

-- Optimize confirmed auth initplan policies on public.projects.
DROP POLICY IF EXISTS "Enable project managers to update projects" ON public.projects;
CREATE POLICY "Enable project managers to update projects"
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (public.is_project_organizer(id, (SELECT auth.uid())))
  WITH CHECK (
    public.is_project_organizer(id, (SELECT auth.uid()))
    AND (
      visibility <> 'public'::text
      OR public.can_keep_or_set_public_visibility(id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Enable project managers to delete projects" ON public.projects;
CREATE POLICY "Enable project managers to delete projects"
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (public.is_project_organizer(id, (SELECT auth.uid())));

-- Invitation token lookup should not re-evaluate request headers for every row.
-- Authenticated users also get one consolidated SELECT policy to avoid multiple
-- permissive SELECT policies for the same role/action.
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.organization_invitations;
DROP POLICY IF EXISTS "Org admins and staff can view invitations" ON public.organization_invitations;

CREATE POLICY "Anyone can read invitation by token"
  ON public.organization_invitations
  FOR SELECT
  TO anon
  USING (
    token = COALESCE(
      NULLIF(((SELECT current_setting('request.headers', true))::jsonb->>'x-invitation-token'), ''),
      '00000000-0000-0000-0000-000000000000'
    )::uuid
  );

CREATE POLICY "Authenticated invitation visibility"
  ON public.organization_invitations
  FOR SELECT
  TO authenticated
  USING (
    token = COALESCE(
      NULLIF(((SELECT current_setting('request.headers', true))::jsonb->>'x-invitation-token'), ''),
      '00000000-0000-0000-0000-000000000000'
    )::uuid
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff'])
    )
  );

-- Split FOR ALL plugin write policies into command-specific policies so they
-- do not overlap read policies for authenticated SELECT.
DROP POLICY IF EXISTS dv_sd_meetings_write ON plugin_data.dv_sd_meetings;
CREATE POLICY dv_sd_meetings_insert
  ON plugin_data.dv_sd_meetings
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_sd_meetings_update
  ON plugin_data.dv_sd_meetings
  FOR UPDATE
  TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_sd_meetings_delete
  ON plugin_data.dv_sd_meetings
  FOR DELETE
  TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

DROP POLICY IF EXISTS dv_sd_teachers_write ON plugin_data.dv_sd_teachers;
CREATE POLICY dv_sd_teachers_insert
  ON plugin_data.dv_sd_teachers
  FOR INSERT
  TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_sd_teachers_update
  ON plugin_data.dv_sd_teachers
  FOR UPDATE
  TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_sd_teachers_delete
  ON plugin_data.dv_sd_teachers
  FOR DELETE
  TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- Defensive cleanup for duplicate org indexes if both old and descriptive names
-- exist after replaying the full migration stack.
DO $$
BEGIN
  IF to_regclass('plugin_data.idx_dv_sd_assignments_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_judge_assignments_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_assignments_org';
  END IF;

  IF to_regclass('plugin_data.idx_dv_sd_links_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_parent_student_links_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_links_org';
  END IF;

  IF to_regclass('plugin_data.idx_dv_sd_forms_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_signup_forms_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_forms_org';
  END IF;

  IF to_regclass('plugin_data.idx_dv_sd_questions_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_signup_questions_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_questions_org';
  END IF;

  IF to_regclass('plugin_data.idx_dv_sd_submissions_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_signup_submissions_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_submissions_org';
  END IF;

  IF to_regclass('plugin_data.idx_dv_sd_answers_org') IS NOT NULL
     AND to_regclass('plugin_data.idx_dv_sd_submission_answers_org') IS NOT NULL THEN
    EXECUTE 'DROP INDEX plugin_data.idx_dv_sd_answers_org';
  END IF;
END $$;

COMMIT;
