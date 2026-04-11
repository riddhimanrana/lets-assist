-- Plugin audit logging and feature flags

-- Plugin audit logs table for tracking all plugin-related actions
create table if not exists public.plugin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  plugin_key text references public.plugins(key) on delete set null,
  action text not null check (action in (
    'plugin.created',
    'plugin.updated',
    'plugin.activated',
    'plugin.deactivated',
    'entitlement.granted',
    'entitlement.revoked',
    'entitlement.updated',
    'install.created',
    'install.enabled',
    'install.disabled',
    'install.updated',
    'install.config_changed',
    'install.version_updated',
    'install.removed',
    'lifecycle.install',
    'lifecycle.uninstall',
    'lifecycle.enable',
    'lifecycle.disable',
    'execution.surface',
    'execution.behavior',
    'execution.api',
    'execution.error'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'admin')),
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  execution_time_ms integer,
  created_at timestamp with time zone not null default now()
);

-- Indexes for efficient querying
create index if not exists idx_plugin_audit_logs_org
  on public.plugin_audit_logs (organization_id);

create index if not exists idx_plugin_audit_logs_plugin
  on public.plugin_audit_logs (plugin_key);

create index if not exists idx_plugin_audit_logs_action
  on public.plugin_audit_logs (action);

create index if not exists idx_plugin_audit_logs_actor
  on public.plugin_audit_logs (actor_id);

create index if not exists idx_plugin_audit_logs_created
  on public.plugin_audit_logs (created_at desc);

-- Composite index for common queries
create index if not exists idx_plugin_audit_logs_org_plugin_created
  on public.plugin_audit_logs (organization_id, plugin_key, created_at desc);

-- Enable RLS
alter table public.plugin_audit_logs enable row level security;

-- Only super admins can read all audit logs
-- Org admins can read their org's audit logs
drop policy if exists "Audit logs readable by org admins" on public.plugin_audit_logs;
create policy "Audit logs readable by org admins"
  on public.plugin_audit_logs
  for select
  to authenticated
  using (
    organization_id is null -- platform-level logs only visible to super admins
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = plugin_audit_logs.organization_id
        and om.user_id = auth.uid()
        and om.role = 'admin'
    )
  );

-- Plugin feature flags table for per-org feature toggles
create table if not exists public.organization_plugin_feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key text not null references public.plugins(key) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  rollout_percentage integer check (rollout_percentage >= 0 and rollout_percentage <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (organization_id, plugin_key, flag_key)
);

-- Indexes for feature flags
create index if not exists idx_plugin_feature_flags_org
  on public.organization_plugin_feature_flags (organization_id);

create index if not exists idx_plugin_feature_flags_plugin
  on public.organization_plugin_feature_flags (plugin_key);

create index if not exists idx_plugin_feature_flags_org_plugin
  on public.organization_plugin_feature_flags (organization_id, plugin_key);

-- Enable RLS
alter table public.organization_plugin_feature_flags enable row level security;

-- Feature flags readable by org members
drop policy if exists "Feature flags readable by org members" on public.organization_plugin_feature_flags;
create policy "Feature flags readable by org members"
  on public.organization_plugin_feature_flags
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_feature_flags.organization_id
        and om.user_id = auth.uid()
    )
  );

-- Feature flags manageable by org admins
drop policy if exists "Feature flags manageable by org admins" on public.organization_plugin_feature_flags;
create policy "Feature flags manageable by org admins"
  on public.organization_plugin_feature_flags
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_feature_flags.organization_id
        and om.user_id = auth.uid()
        and om.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = organization_plugin_feature_flags.organization_id
        and om.user_id = auth.uid()
        and om.role = 'admin'
    )
  );

-- Add permission scopes to plugins table
alter table public.plugins
  add column if not exists required_scopes text[] not null default '{}',
  add column if not exists config_schema jsonb;

-- Add execution metrics columns to installs
alter table public.organization_plugin_installs
  add column if not exists total_executions bigint not null default 0,
  add column if not exists total_errors bigint not null default 0,
  add column if not exists avg_execution_time_ms integer,
  add column if not exists last_execution_at timestamp with time zone,
  add column if not exists last_error_at timestamp with time zone,
  add column if not exists last_error_message text;

-- Helper function to log plugin audit events
create or replace function public.log_plugin_audit(
  p_organization_id uuid,
  p_plugin_key text,
  p_action text,
  p_actor_id uuid,
  p_actor_type text default 'user',
  p_details jsonb default '{}'::jsonb,
  p_execution_time_ms integer default null
) returns uuid as $$
declare
  v_log_id uuid;
begin
  insert into public.plugin_audit_logs (
    organization_id,
    plugin_key,
    action,
    actor_id,
    actor_type,
    details,
    execution_time_ms
  ) values (
    p_organization_id,
    p_plugin_key,
    p_action,
    p_actor_id,
    p_actor_type,
    p_details,
    p_execution_time_ms
  )
  returning id into v_log_id;
  
  return v_log_id;
end;
$$ language plpgsql security definer;

-- Function to update execution metrics on an install
create or replace function public.update_plugin_execution_metrics(
  p_organization_id uuid,
  p_plugin_key text,
  p_execution_time_ms integer,
  p_is_error boolean default false,
  p_error_message text default null
) returns void as $$
begin
  update public.organization_plugin_installs
  set
    total_executions = total_executions + 1,
    total_errors = case when p_is_error then total_errors + 1 else total_errors end,
    avg_execution_time_ms = case
      when avg_execution_time_ms is null then p_execution_time_ms
      else (avg_execution_time_ms + p_execution_time_ms) / 2
    end,
    last_execution_at = now(),
    last_error_at = case when p_is_error then now() else last_error_at end,
    last_error_message = case when p_is_error then p_error_message else last_error_message end,
    updated_at = now()
  where organization_id = p_organization_id
    and plugin_key = p_plugin_key;
end;
$$ language plpgsql security definer;

-- Grant execute on functions to authenticated users
grant execute on function public.log_plugin_audit to authenticated;
grant execute on function public.update_plugin_execution_metrics to authenticated;
