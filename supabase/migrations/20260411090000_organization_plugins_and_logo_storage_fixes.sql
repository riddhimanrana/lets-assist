-- Bring local/remote schemas back in sync for plugin installs and org logo uploads.

alter table public.organization_plugin_installs
  add column if not exists configuration jsonb not null default '{}'::jsonb;

alter table public.organization_plugin_installs
  alter column configuration set default '{}'::jsonb;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "Authenticated users can upload organization logos" on storage.objects;
    create policy "Authenticated users can upload organization logos"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'organization-logos'
        and exists (
          select 1
          from public.organization_members om
          where om.organization_id = split_part(name, '.', 1)::uuid
            and om.user_id = auth.uid()
            and om.role in ('admin', 'staff')
        )
      );

    drop policy if exists "Authenticated users can update organization logos" on storage.objects;
    create policy "Authenticated users can update organization logos"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'organization-logos'
        and exists (
          select 1
          from public.organization_members om
          where om.organization_id = split_part(name, '.', 1)::uuid
            and om.user_id = auth.uid()
            and om.role in ('admin', 'staff')
        )
      )
      with check (
        bucket_id = 'organization-logos'
        and exists (
          select 1
          from public.organization_members om
          where om.organization_id = split_part(name, '.', 1)::uuid
            and om.user_id = auth.uid()
            and om.role in ('admin', 'staff')
        )
      );

    drop policy if exists "Authenticated users can delete organization logos" on storage.objects;
    create policy "Authenticated users can delete organization logos"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'organization-logos'
        and exists (
          select 1
          from public.organization_members om
          where om.organization_id = split_part(name, '.', 1)::uuid
            and om.user_id = auth.uid()
            and om.role in ('admin', 'staff')
        )
      );

    drop policy if exists "Public can read organization logos" on storage.objects;
    create policy "Public can read organization logos"
      on storage.objects
      for select
      to public
      using (bucket_id = 'organization-logos');
  end if;
end $$;