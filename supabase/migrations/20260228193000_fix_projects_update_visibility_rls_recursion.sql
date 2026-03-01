begin;

create or replace function public.can_keep_or_set_public_visibility(
  p_project_id uuid,
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select
    public.is_trusted_member(p_user)
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.creator_id = p_user
        and p.visibility = 'public'
    );
$$;

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
    or public.can_keep_or_set_public_visibility(id, auth.uid())
  )
);

commit;