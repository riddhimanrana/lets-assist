-- Phase C cutover step 2: broaden plugin access view coverage.
-- Include org+plugin rows that come from either installs or entitlements,
-- so admin/settings read paths can consolidate on one view.

create or replace view public.organization_plugin_access
with (security_invoker = true) as
with organization_plugin_keys as (
  select organization_id, plugin_key
  from public.organization_plugin_installs
  union
  select organization_id, plugin_key
  from public.organization_plugin_entitlements
)
select
  k.organization_id,
  k.plugin_key,
  coalesce(i.enabled, false) as enabled,
  i.configuration,
  i.installed_version,
  i.installed_at,
  i.updated_at as install_updated_at,
  i.created_at as install_created_at,

  p.name as plugin_name,
  p.description as plugin_description,
  p.visibility,
  p.is_active,
  p.latest_version,
  p.force_update_version,
  p.code_repository,
  p.code_reference,
  p.private_codebase,
  p.updated_at as plugin_updated_at,
  p.created_at as plugin_created_at,

  e.id as entitlement_id,
  e.status as entitlement_status,
  e.starts_at as entitlement_starts_at,
  e.ends_at as entitlement_ends_at,
  e.updated_at as entitlement_updated_at,
  e.created_at as entitlement_created_at,

  (
    e.status = 'active'
    and (e.starts_at is null or e.starts_at <= now())
    and (e.ends_at is null or e.ends_at >= now())
  ) as entitlement_active,

  (
    coalesce(i.enabled, false)
    and p.is_active
    and (
      p.visibility = 'global'
      or (
        e.status = 'active'
        and (e.starts_at is null or e.starts_at <= now())
        and (e.ends_at is null or e.ends_at >= now())
      )
    )
  ) as is_accessible
from organization_plugin_keys k
join public.plugins p
  on p.key = k.plugin_key
left join public.organization_plugin_installs i
  on i.organization_id = k.organization_id
 and i.plugin_key = k.plugin_key
left join public.organization_plugin_entitlements e
  on e.organization_id = k.organization_id
 and e.plugin_key = k.plugin_key;

comment on view public.organization_plugin_access is
  'Consolidated plugin access read model for organizations (catalog + install + entitlement).';

revoke all on public.organization_plugin_access from anon;
grant select on public.organization_plugin_access to authenticated;
grant select on public.organization_plugin_access to service_role;
