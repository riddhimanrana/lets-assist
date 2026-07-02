-- Make write-side RLS checks explicit for policies that previously relied on
-- PostgreSQL's implicit fallback from USING to WITH CHECK.
--
-- Keeping these expressions explicit makes future policy reviews safer and
-- prevents accidental tenant/owner reassignment when policy predicates evolve.

BEGIN;

ALTER POLICY dv_sd_attendance_update
  ON plugin_data.dv_sd_meeting_attendance
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

ALTER POLICY sheet_sync_staff
  ON plugin_data.dv_sd_sheet_sync_configs
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

ALTER POLICY billing_accounts_admin
  ON plugin_data.org_billing_accounts
  WITH CHECK (private.is_org_admin(organization_id));

ALTER POLICY form_subs_staff_update
  ON plugin_data.org_form_submissions
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

ALTER POLICY "Users can update their own notifications"
  ON public.notifications
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "Allow admins to update organizations"
  ON public.organizations
  WITH CHECK (
    (select auth.uid()) in (
      select organization_members.user_id
      from public.organization_members
      where organization_members.organization_id = organizations.id
        and organization_members.role::text = 'admin'::text
    )
  );

ALTER POLICY "Users can update their own calendar connections"
  ON public.user_calendar_connections
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY waiver_signatures_update_policy
  ON public.waiver_signatures
  WITH CHECK (
    ((select auth.uid()) = user_id)
    or exists (
      select 1
      from public.projects p
      where p.id = waiver_signatures.project_id
        and (
          p.creator_id = (select auth.uid())
          or exists (
            select 1
            from public.organization_members om
            where om.organization_id = p.organization_id
              and om.user_id = (select auth.uid())
              and om.role::text = any (array['admin'::varchar, 'staff'::varchar]::text[])
          )
        )
    )
  );

COMMIT;
