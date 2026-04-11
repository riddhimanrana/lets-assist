-- Simplify waiver data model by removing legacy template table/column.
-- Keep waiver definitions as the canonical source of waiver content and signer mappings.

alter table if exists public.waiver_signatures
  drop constraint if exists waiver_signatures_waiver_template_id_fkey;

drop index if exists public.idx_waiver_signatures_waiver_template_id;

alter table if exists public.waiver_signatures
  drop column if exists waiver_template_id;

drop table if exists public.waiver_templates;

-- Ensure linter search_path warnings remain resolved even if prior advisory migration
-- was not applied in a given environment.
alter function public.ensure_profile_exists(uuid)
  set search_path = public, pg_temp;

alter function public.before_insert_org_member()
  set search_path = public, pg_temp;

alter function public.set_system_banners_updated_at()
  set search_path = public, pg_temp;

-- banned_emails has RLS enabled in production but lacked explicit policies.
-- Keep client access fully blocked; service_role bypasses RLS for server-side moderation flows.
alter table if exists public.banned_emails enable row level security;

drop policy if exists banned_emails_no_client_access on public.banned_emails;

create policy banned_emails_no_client_access
  on public.banned_emails
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Cover FK lookups flagged by advisor.
create index if not exists account_data_export_jobs_requested_by_idx
  on public.account_data_export_jobs (requested_by);

create index if not exists banned_emails_banned_by_idx
  on public.banned_emails (banned_by);

create index if not exists waiver_definitions_created_by_idx
  on public.waiver_definitions (created_by);
