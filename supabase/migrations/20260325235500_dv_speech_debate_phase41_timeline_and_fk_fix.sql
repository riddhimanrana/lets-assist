-- Phase 4.1: DV profile timeline + foreign key alignment

alter table public.dv_sd_signup_submissions
  drop constraint if exists dv_sd_signup_submissions_student_profile_id_fkey;

alter table public.dv_sd_signup_submissions
  add constraint dv_sd_signup_submissions_student_profile_id_fkey
  foreign key (student_profile_id)
  references public.dv_sd_student_profiles(id)
  on delete set null;

create table if not exists public.dv_sd_profile_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  profile_type text not null check (profile_type in ('student', 'parent', 'link', 'submission', 'bulk_import')),
  student_profile_id uuid references public.dv_sd_student_profiles(id) on delete set null,
  parent_profile_id uuid references public.dv_sd_parent_profiles(id) on delete set null,
  link_id uuid references public.dv_sd_profile_links(id) on delete set null,
  submission_id uuid references public.dv_sd_signup_submissions(id) on delete set null,
  action text not null,
  title text not null,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_dv_sd_activity_org_created_at
  on public.dv_sd_profile_activity_log (organization_id, created_at desc);

create index if not exists idx_dv_sd_activity_student
  on public.dv_sd_profile_activity_log (student_profile_id, created_at desc);

create index if not exists idx_dv_sd_activity_parent
  on public.dv_sd_profile_activity_log (parent_profile_id, created_at desc);

alter table public.dv_sd_profile_activity_log enable row level security;

drop policy if exists "DV activity readable by org members" on public.dv_sd_profile_activity_log;
create policy "DV activity readable by org members"
  on public.dv_sd_profile_activity_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_profile_activity_log.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV activity writable by org admins and staff" on public.dv_sd_profile_activity_log;
create policy "DV activity writable by org admins and staff"
  on public.dv_sd_profile_activity_log
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_profile_activity_log.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );