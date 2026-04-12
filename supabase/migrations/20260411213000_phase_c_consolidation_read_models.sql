-- Phase C foundation: introduce non-breaking read models for table consolidation.
-- This keeps existing tables/writes intact while enabling simpler consolidated reads.

-- 1) Plugin access read model
-- Combines plugin catalog + org installs + entitlements into one query surface.

drop view if exists public.organization_plugin_access;

create view public.organization_plugin_access
with (security_invoker = true) as
select
  i.organization_id,
  i.plugin_key,
  i.enabled,
  i.configuration,
  i.installed_version,
  i.installed_at,
  i.updated_at as install_updated_at,
  i.installed_at as install_created_at,

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
    i.enabled
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
from public.organization_plugin_installs i
join public.plugins p
  on p.key = i.plugin_key
left join public.organization_plugin_entitlements e
  on e.organization_id = i.organization_id
 and e.plugin_key = i.plugin_key;

comment on view public.organization_plugin_access is
  'Consolidated plugin access read model for organizations (catalog + install + entitlement).';

revoke all on public.organization_plugin_access from anon;
grant select on public.organization_plugin_access to authenticated;
grant select on public.organization_plugin_access to service_role;

-- 2) Moderation events read model
-- Unifies content_flags and content_reports into a common event stream for dashboards/analytics.

drop view if exists public.content_moderation_events;

create view public.content_moderation_events
with (security_invoker = true) as
select
  f.id as source_id,
  'flag'::text as source,
  f.created_at,
  f.created_at as updated_at,
  f.content_type,
  f.content_id,
  f.status,
  case
    when f.confidence_score >= 0.8 then 'critical'
    when f.confidence_score >= 0.5 then 'high'
    else 'normal'
  end::text as priority,
  null::uuid as reporter_id,
  f.reviewed_by,
  f.reviewed_at,
  null::timestamp with time zone as resolved_at,
  f.flag_type as reason,
  null::text as description,
  f.review_notes as resolution_notes,
  f.flag_source,
  f.confidence_score,
  f.ai_metadata,
  f.flag_details as details
from (
  select
    id,
    content_type,
    content_id,
    status,
    reviewed_by,
    reviewed_at,
    review_notes,
    flag_type,
    flag_source,
    confidence_score,
    coalesce(flag_details -> 'ai_metadata', null) as ai_metadata,
    flag_details,
    created_at
  from public.content_flags
) f

union all

select
  r.id as source_id,
  'report'::text as source,
  r.created_at,
  coalesce(r.updated_at, r.created_at) as updated_at,
  r.content_type,
  r.content_id,
  r.status,
  coalesce(nullif(r.priority, ''), 'normal')::text as priority,
  r.reporter_id,
  r.reviewed_by,
  r.reviewed_at,
  r.resolved_at,
  r.reason,
  r.description,
  r.resolution_notes,
  case when r.ai_metadata is null then 'user' else 'ai' end::text as flag_source,
  null::numeric as confidence_score,
  r.ai_metadata,
  r.ai_metadata as details
from public.content_reports r;

comment on view public.content_moderation_events is
  'Unified moderation event stream combining AI/content flags and user reports.';

revoke all on public.content_moderation_events from anon;
revoke all on public.content_moderation_events from authenticated;
grant select on public.content_moderation_events to service_role;
