begin;

create or replace function public.is_project_organizer(p_project_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select coalesce(
    p_user is not null
    and exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and (
          p.creator_id = p_user
          or exists (
            select 1
            from public.organization_members om
            where om.organization_id = p.organization_id
              and om.user_id = p_user
              and om.role in ('admin', 'staff')
          )
        )
    ),
    false
  );
$$;

drop policy if exists profiles_select_anon on public.profiles;
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_authenticated on public.profiles;

create policy profiles_select_authenticated_self_super_admin_or_org_staff
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or public.is_super_admin()
  or exists (
    select 1
    from public.organization_members viewer
    join public.organization_members target
      on target.organization_id = viewer.organization_id
    where viewer.user_id = auth.uid()
      and viewer.role in ('admin', 'staff')
      and target.user_id = public.profiles.id
  )
);

create policy profiles_update_authenticated_self_or_super_admin
on public.profiles
for update
to authenticated
using (
  auth.uid() = id
  or public.is_super_admin()
)
with check (
  auth.uid() = id
  or public.is_super_admin()
);

drop policy if exists "project_signups select all" on public.project_signups;
drop policy if exists "project_signups insert hardened" on public.project_signups;
drop policy if exists project_signups_update_merged_public on public.project_signups;
drop policy if exists "project_signups delete hardened" on public.project_signups;

create policy project_signups_select_authenticated
on public.project_signups
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy project_signups_insert_authenticated
on public.project_signups
for insert
to authenticated
with check (
  (auth.uid() is not null and user_id = auth.uid())
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy project_signups_update_authenticated
on public.project_signups
for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
)
with check (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy project_signups_delete_authenticated
on public.project_signups
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

drop policy if exists anon_signups_select_anyone on public.anonymous_signups;
drop policy if exists anon_signups_insert_anyone on public.anonymous_signups;
drop policy if exists anon_signups_update_policy on public.anonymous_signups;
drop policy if exists anon_signups_delete_policy on public.anonymous_signups;

create policy anonymous_signups_select_authenticated
on public.anonymous_signups
for select
to authenticated
using (
  linked_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy anonymous_signups_insert_authenticated
on public.anonymous_signups
for insert
to authenticated
with check (
  public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy anonymous_signups_update_authenticated
on public.anonymous_signups
for update
to authenticated
using (
  linked_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
)
with check (
  linked_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

create policy anonymous_signups_delete_authenticated
on public.anonymous_signups
for delete
to authenticated
using (
  linked_user_id = auth.uid()
  or public.is_super_admin()
  or public.is_project_organizer(project_id, auth.uid())
);

drop policy if exists certificates_select_anon on public.certificates;
drop policy if exists certificates_select_authenticated on public.certificates;

create policy certificates_select_authenticated_owner_or_organizer
on public.certificates
for select
to authenticated
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or creator_id = auth.uid()
  or lower(coalesce(volunteer_email, '')) = lower(
    coalesce(
      (
        select p.email
        from public.profiles p
        where p.id = auth.uid()
      )::text,
      ''
    )
  )
  or public.is_project_organizer(project_id, auth.uid())
);

drop policy if exists "Org members can read calendar sync" on public.organization_calendar_syncs;
drop policy if exists "Org admins can insert calendar sync" on public.organization_calendar_syncs;
drop policy if exists "Org admins/staff can update calendar sync" on public.organization_calendar_syncs;
drop policy if exists "Org admins can delete calendar sync" on public.organization_calendar_syncs;

create policy "Org members can read calendar sync"
on public.organization_calendar_syncs
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_syncs.organization_id
  )
);

create policy "Org admins can insert calendar sync"
on public.organization_calendar_syncs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_syncs.organization_id
      and om.role = 'admin'
  )
);

create policy "Org admins/staff can update calendar sync"
on public.organization_calendar_syncs
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_syncs.organization_id
      and om.role in ('admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_syncs.organization_id
      and om.role in ('admin', 'staff')
  )
);

create policy "Org admins can delete calendar sync"
on public.organization_calendar_syncs
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_syncs.organization_id
      and om.role = 'admin'
  )
);

drop policy if exists "Org members can read calendar events" on public.organization_calendar_events;
drop policy if exists "Org admins/staff can create calendar events" on public.organization_calendar_events;
drop policy if exists "Org admins/staff can update calendar events" on public.organization_calendar_events;
drop policy if exists "Org admins/staff can delete calendar events" on public.organization_calendar_events;

create policy "Org members can read calendar events"
on public.organization_calendar_events
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_events.organization_id
  )
);

create policy "Org admins/staff can create calendar events"
on public.organization_calendar_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_events.organization_id
      and om.role in ('admin', 'staff')
  )
);

create policy "Org admins/staff can update calendar events"
on public.organization_calendar_events
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_events.organization_id
      and om.role in ('admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_events.organization_id
      and om.role in ('admin', 'staff')
  )
);

create policy "Org admins/staff can delete calendar events"
on public.organization_calendar_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = public.organization_calendar_events.organization_id
      and om.role in ('admin', 'staff')
  )
);

commit;
