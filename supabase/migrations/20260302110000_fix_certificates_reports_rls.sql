begin;

-- Normalize existing organization/project certificates so report logic and RLS
-- can reliably treat published hours as verified.
update public.certificates
set type = 'verified'
where project_id is not null
  and coalesce(type, '') = '';

drop policy if exists "certificates_select_authenticated" on public.certificates;
create policy "certificates_select_authenticated"
on public.certificates
as permissive
for select
to authenticated
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or (
    lower(coalesce(volunteer_email, '')) = lower(
      coalesce((
        select p.email
        from public.profiles p
        where p.id = auth.uid()
      ), '')
    )
  )
  or exists (
    select 1
    from public.projects p
    where p.id = certificates.project_id
      and p.creator_id = auth.uid()
  )
  or exists (
    select 1
    from public.projects p
    join public.organization_members om
      on om.organization_id = p.organization_id
    where p.id = certificates.project_id
      and om.user_id = auth.uid()
      and om.role in ('admin', 'staff')
  )
  or type = 'verified'
  or (type = 'self-reported' and user_id = auth.uid())
);

commit;