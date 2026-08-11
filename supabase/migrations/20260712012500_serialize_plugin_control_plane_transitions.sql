-- Serialize plugin lifecycle hooks with their install-state mutations.
--
-- Lifecycle hooks can touch plugin-owned tables or external systems, so two
-- opposite transitions must never execute concurrently for the same
-- organization/plugin pair. The application acquires this short-lived lease
-- before reading install state and always releases it in a finally block.

create table if not exists private.plugin_control_plane_transition_locks (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  plugin_key text not null
    references public.plugins(key) on delete cascade,
  lock_token uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (organization_id, plugin_key)
);

comment on table private.plugin_control_plane_transition_locks is
  'Service-role leases that serialize plugin lifecycle hooks and install-state transitions.';

create or replace function public.acquire_plugin_control_plane_transition_lock(
  p_organization_id uuid,
  p_plugin_key text,
  p_lock_token uuid,
  p_ttl_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required'
      using errcode = '42501';
  end if;

  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'lock TTL must be between 30 and 3600 seconds'
      using errcode = '22023';
  end if;

  insert into private.plugin_control_plane_transition_locks (
    organization_id,
    plugin_key,
    lock_token,
    acquired_at,
    expires_at
  )
  values (
    p_organization_id,
    p_plugin_key,
    p_lock_token,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (organization_id, plugin_key) do update
  set
    lock_token = excluded.lock_token,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  where private.plugin_control_plane_transition_locks.expires_at <= now();

  return found;
end;
$$;

create or replace function public.refresh_plugin_control_plane_transition_lock(
  p_organization_id uuid,
  p_plugin_key text,
  p_lock_token uuid,
  p_ttl_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required'
      using errcode = '42501';
  end if;

  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'lock TTL must be between 30 and 3600 seconds'
      using errcode = '22023';
  end if;

  update private.plugin_control_plane_transition_locks
  set expires_at = now() + make_interval(secs => p_ttl_seconds)
  where organization_id = p_organization_id
    and plugin_key = p_plugin_key
    and lock_token = p_lock_token
    and expires_at > now();

  return found;
end;
$$;

create or replace function public.release_plugin_control_plane_transition_lock(
  p_organization_id uuid,
  p_plugin_key text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role is required'
      using errcode = '42501';
  end if;

  delete from private.plugin_control_plane_transition_locks
  where organization_id = p_organization_id
    and plugin_key = p_plugin_key
    and lock_token = p_lock_token;

  return found;
end;
$$;

revoke all on function public.acquire_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.refresh_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_plugin_control_plane_transition_lock(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  to service_role;
grant execute on function public.refresh_plugin_control_plane_transition_lock(uuid, text, uuid, integer)
  to service_role;
grant execute on function public.release_plugin_control_plane_transition_lock(uuid, text, uuid)
  to service_role;
