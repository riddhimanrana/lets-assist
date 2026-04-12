-- Fix Supabase advisor findings: security + performance

-- 1) SECURITY: set explicit search_path on mutable functions
alter function public.ensure_profile_exists(uuid)
  set search_path = public, pg_temp;

alter function public.before_insert_org_member()
  set search_path = public, pg_temp;

alter function public.set_system_banners_updated_at()
  set search_path = public, pg_temp;


-- 2) SECURITY: RLS enabled without policy (make intent explicit: no client access)
drop policy if exists banned_emails_no_client_access on public.banned_emails;
create policy banned_emails_no_client_access
  on public.banned_emails
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);


-- 3) PERFORMANCE: add missing covering indexes for foreign keys
create index if not exists idx_account_data_export_jobs_requested_by
  on public.account_data_export_jobs using btree (requested_by);

create index if not exists idx_banned_emails_banned_by
  on public.banned_emails using btree (banned_by);

create index if not exists idx_waiver_definitions_created_by
  on public.waiver_definitions using btree (created_by);


-- 4) PERFORMANCE: remove duplicate permissive SELECT overlap on waiver write policies
--    Old *_write_policy defaults to FOR ALL (including SELECT). Split write access by action.

-- waiver_definition_fields
drop policy if exists waiver_definition_fields_write_policy on public.waiver_definition_fields;
drop policy if exists waiver_definition_fields_insert_policy on public.waiver_definition_fields;
drop policy if exists waiver_definition_fields_delete_policy on public.waiver_definition_fields;

create policy waiver_definition_fields_insert_policy
  on public.waiver_definition_fields
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_fields.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

create policy waiver_definition_fields_write_policy
  on public.waiver_definition_fields
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_fields.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_fields.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

create policy waiver_definition_fields_delete_policy
  on public.waiver_definition_fields
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_fields.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

-- waiver_definition_signers
drop policy if exists waiver_definition_signers_write_policy on public.waiver_definition_signers;
drop policy if exists waiver_definition_signers_insert_policy on public.waiver_definition_signers;
drop policy if exists waiver_definition_signers_delete_policy on public.waiver_definition_signers;

create policy waiver_definition_signers_insert_policy
  on public.waiver_definition_signers
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_signers.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

create policy waiver_definition_signers_write_policy
  on public.waiver_definition_signers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_signers.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_signers.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

create policy waiver_definition_signers_delete_policy
  on public.waiver_definition_signers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.waiver_definitions wd
      where wd.id = waiver_definition_signers.waiver_definition_id
        and wd.scope = 'project'
        and exists (
          select 1
          from public.projects p
          where p.id = wd.project_id
            and p.creator_id = (select auth.uid())
        )
    )
  );

-- waiver_definitions
drop policy if exists waiver_definitions_write_policy on public.waiver_definitions;
drop policy if exists waiver_definitions_insert_policy on public.waiver_definitions;
drop policy if exists waiver_definitions_delete_policy on public.waiver_definitions;

create policy waiver_definitions_insert_policy
  on public.waiver_definitions
  for insert
  to authenticated
  with check (
    scope = 'project'
    and exists (
      select 1
      from public.projects p
      where p.id = waiver_definitions.project_id
        and p.creator_id = (select auth.uid())
    )
  );

create policy waiver_definitions_write_policy
  on public.waiver_definitions
  for update
  to authenticated
  using (
    scope = 'project'
    and exists (
      select 1
      from public.projects p
      where p.id = waiver_definitions.project_id
        and p.creator_id = (select auth.uid())
    )
  )
  with check (
    scope = 'project'
    and exists (
      select 1
      from public.projects p
      where p.id = waiver_definitions.project_id
        and p.creator_id = (select auth.uid())
    )
  );

create policy waiver_definitions_delete_policy
  on public.waiver_definitions
  for delete
  to authenticated
  using (
    scope = 'project'
    and exists (
      select 1
      from public.projects p
      where p.id = waiver_definitions.project_id
        and p.creator_id = (select auth.uid())
    )
  );


-- 5) PERFORMANCE: apply initplan optimization to advisor-flagged policies
--    Replace direct auth.uid() calls with (select auth.uid()) in policy expressions.
do $$
declare
  rec record;
  v_using text;
  v_check text;
  target_policies text[] := array[
    'Create org with cooldown',
    'Enable project creators to update their projects',
    'Manage member inserts',
    'Org admins can delete calendar sync',
    'Org admins can insert calendar sync',
    'Org admins/staff can create calendar events',
    'Org admins/staff can delete calendar events',
    'Org admins/staff can update calendar events',
    'Org admins/staff can update calendar sync',
    'Org members can read calendar events',
    'Org members can read calendar sync',
    'Users can insert own export jobs',
    'Users can view own export audit logs',
    'Users can view own export jobs',
    'anonymous_signups_delete_authenticated',
    'anonymous_signups_insert_authenticated',
    'anonymous_signups_select_authenticated',
    'anonymous_signups_update_authenticated',
    'notification_settings_insert_own_or_admin',
    'notification_settings_select_own_or_admin',
    'notification_settings_update_own_or_admin',
    'certificates_select_authenticated_owner_or_organizer',
    'profiles_select_authenticated_self_super_admin_or_org_staff',
    'profiles_update_authenticated_self_or_super_admin',
    'project_signups_delete_authenticated',
    'project_signups_insert_authenticated',
    'project_signups_select_authenticated',
    'project_signups_update_authenticated',
    'projects insert consolidated',
    'projects_select_authenticated',
    'waiver_signatures_insert_policy',
    'waiver_signatures_read_policy',
    'waiver_signatures_update_policy',
    'plugin_entitlements_select_org_member',
    'plugin_installs_select_org_member',
    'Entitlements readable by org admins and staff',
    'Plugin installs readable by org members',
    'Plugin installs manageable by org admins and staff'
  ];
begin
  for rec in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and policyname = any(target_policies)
  loop
    v_using := rec.qual;
    v_check := rec.with_check;

    if v_using is not null then
      v_using := replace(v_using, 'auth.uid()', '(select auth.uid())');
      v_using := replace(v_using, '"auth"."uid"()', '(select auth.uid())');
    end if;

    if v_check is not null then
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
      v_check := replace(v_check, '"auth"."uid"()', '(select auth.uid())');
    end if;

    if rec.qual is distinct from v_using
       or rec.with_check is distinct from v_check then
      execute format(
        'alter policy %I on %I.%I %s%s%s',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        case when v_using is not null then format('using (%s)', v_using) else '' end,
        case when v_using is not null and v_check is not null then ' ' else '' end,
        case when v_check is not null then format('with check (%s)', v_check) else '' end
      );
    end if;
  end loop;
end
$$;