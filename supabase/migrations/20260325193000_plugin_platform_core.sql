-- Plugin platform core tables

create table if not exists public.plugins (
  key text primary key,
  name text not null,
  description text,
  visibility text not null check (visibility in ('global', 'private')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.organization_plugin_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key text not null references public.plugins(key) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, plugin_key)
);

create table if not exists public.organization_plugin_installs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key text not null references public.plugins(key) on delete cascade,
  enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  installed_by uuid references auth.users(id) on delete set null,
  installed_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, plugin_key)
);

create index if not exists idx_plugin_entitlements_org
  on public.organization_plugin_entitlements (organization_id);

create index if not exists idx_plugin_entitlements_plugin
  on public.organization_plugin_entitlements (plugin_key);

create index if not exists idx_plugin_installs_org
  on public.organization_plugin_installs (organization_id);

create index if not exists idx_plugin_installs_plugin
  on public.organization_plugin_installs (plugin_key);

alter table public.plugins enable row level security;
alter table public.organization_plugin_entitlements enable row level security;
alter table public.organization_plugin_installs enable row level security;

drop policy if exists "Plugins readable by authenticated users" on public.plugins;
create policy "Plugins readable by authenticated users"
  on public.plugins
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "Entitlements readable by org admins and staff" on public.organization_plugin_entitlements;
create policy "Entitlements readable by org admins and staff"
  on public.organization_plugin_entitlements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_entitlements.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "Plugin installs readable by org members" on public.organization_plugin_installs;
create policy "Plugin installs readable by org members"
  on public.organization_plugin_installs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_installs.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "Plugin installs manageable by org admins and staff" on public.organization_plugin_installs;
create policy "Plugin installs manageable by org admins and staff"
  on public.organization_plugin_installs
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_installs.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_installs.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );