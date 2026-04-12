-- Phase 3 plugin platform controls
-- Adds plugin source metadata + version rollout control fields

alter table public.plugins
  add column if not exists latest_version text not null default '1.0.0',
  add column if not exists force_update_version text,
  add column if not exists code_repository text,
  add column if not exists code_reference text,
  add column if not exists private_codebase boolean not null default true,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.organization_plugin_installs
  add column if not exists installed_version text,
  add column if not exists auto_update boolean not null default true,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists last_version_update_at timestamp with time zone;

update public.organization_plugin_installs i
set
  installed_version = coalesce(i.installed_version, p.latest_version, '1.0.0'),
  last_version_update_at = coalesce(i.last_version_update_at, i.installed_at, now())
from public.plugins p
where p.key = i.plugin_key;

update public.organization_plugin_installs
set installed_version = '1.0.0'
where installed_version is null;

alter table public.organization_plugin_installs
  alter column installed_version set default '1.0.0',
  alter column installed_version set not null;

create index if not exists idx_plugins_visibility_active
  on public.plugins (visibility, is_active);

create index if not exists idx_plugin_installs_org_plugin
  on public.organization_plugin_installs (organization_id, plugin_key);