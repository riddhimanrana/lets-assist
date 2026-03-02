begin;

create or replace function public.is_trusted_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select
    coalesce((
      select p.trusted_member
      from public.profiles p
      where p.id = p_user
    ), false)
    or exists (
      select 1
      from public.trusted_member tm
      where tm.user_id = p_user
        and tm.status is true
    );
$$;

create or replace function public.can_insert_project(
  p_user uuid,
  p_visibility text,
  p_organization_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  recent_count int;
begin
  if p_user is null then
    return false;
  end if;

  -- Keep rate limit aligned with application server actions.
  select count(*)
    into recent_count
  from public.projects
  where creator_id = p_user
    and created_at > (now() - interval '24 hours');

  if recent_count >= 10 then
    return false;
  end if;

  -- Public-feed projects require trusted status.
  if coalesce(p_visibility, 'public') = 'public'
     and not public.is_trusted_member(p_user) then
    return false;
  end if;

  -- Organization-affiliated projects require org admin/staff role.
  if p_organization_id is not null
     and not exists (
       select 1
       from public.organization_members om
       where om.organization_id = p_organization_id
         and om.user_id = p_user
         and om.role in ('admin', 'staff')
     ) then
    return false;
  end if;

  return true;
end;
$$;

-- Legacy wrapper for older single-argument callers, if any.
create or replace function public.can_insert_project(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  return public.can_insert_project(p_user, 'public', null);
end;
$$;

drop policy if exists "Create org with cooldown" on public.organizations;
create policy "Create org with cooldown"
on public.organizations
as permissive
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.is_trusted_member(auth.uid())
  and (
    select count(*)
    from public.organizations o2
    where o2.created_by = auth.uid()
      and o2.created_at > (now() - interval '14 days')
  ) < 5
);

drop policy if exists "projects insert consolidated" on public.projects;
create policy "projects insert consolidated"
on public.projects
as permissive
for insert
to authenticated
with check (
  auth.uid() is not null
  and creator_id = auth.uid()
  and public.can_insert_project(auth.uid(), visibility, organization_id)
);

drop policy if exists "Enable project creators to update their projects" on public.projects;
create policy "Enable project creators to update their projects"
on public.projects
as permissive
for update
to public
using (
  auth.uid() = creator_id
)
with check (
  auth.uid() = creator_id
  and (
    visibility <> 'public'
    or public.is_trusted_member(auth.uid())
    or exists (
      select 1
      from public.projects p_old
      where p_old.id = projects.id
        and p_old.creator_id = auth.uid()
        and p_old.visibility = 'public'
    )
  )
);

-- Prevent self-granting admin/staff roles while preserving org creation bootstrap and normal joins.
drop policy if exists "Manage member inserts" on public.organization_members;
create policy "Manage member inserts"
on public.organization_members
as permissive
for insert
to authenticated
with check (
  (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.role = 'admin'
    )
  )
  or (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.role = 'staff'
    )
    and role <> 'admin'
  )
  or (
    user_id = auth.uid()
    and role = 'member'
  )
  or (
    user_id = auth.uid()
    and role = 'admin'
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = auth.uid()
    )
  )
);

commit;