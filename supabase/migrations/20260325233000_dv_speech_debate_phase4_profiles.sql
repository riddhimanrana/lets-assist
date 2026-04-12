-- Phase 4: DV Speech & Debate profile graph
-- Adds organization-scoped student/parent profiles and explicit link table.

create table if not exists public.dv_sd_student_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_name text not null,
  email text,
  phone text,
  grade_level text,
  paid_membership boolean not null default false,
  membership_receipt_url text,
  times_competed integer not null default 0,
  times_judged integer not null default 0,
  source text not null default 'manual' check (source in ('manual', 'signup', 'sheet_import', 'api_sync')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (times_competed >= 0),
  check (times_judged >= 0)
);

create table if not exists public.dv_sd_parent_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_name text not null,
  email text,
  phone text,
  can_judge boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'signup', 'sheet_import', 'api_sync')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.dv_sd_profile_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_profile_id uuid not null references public.dv_sd_parent_profiles(id) on delete cascade,
  student_profile_id uuid not null references public.dv_sd_student_profiles(id) on delete cascade,
  relationship text not null default 'parent',
  is_primary_contact boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, parent_profile_id, student_profile_id)
);

alter table public.dv_sd_signup_submissions
  add column if not exists parent_profile_id uuid references public.dv_sd_parent_profiles(id) on delete set null;

create index if not exists idx_dv_sd_student_profiles_org
  on public.dv_sd_student_profiles (organization_id);

create index if not exists idx_dv_sd_parent_profiles_org
  on public.dv_sd_parent_profiles (organization_id);

create index if not exists idx_dv_sd_profile_links_org
  on public.dv_sd_profile_links (organization_id);

create unique index if not exists idx_dv_sd_student_profiles_org_email_unique
  on public.dv_sd_student_profiles (organization_id, lower(email))
  where email is not null;

create unique index if not exists idx_dv_sd_parent_profiles_org_email_unique
  on public.dv_sd_parent_profiles (organization_id, lower(email))
  where email is not null;

alter table public.dv_sd_student_profiles enable row level security;
alter table public.dv_sd_parent_profiles enable row level security;
alter table public.dv_sd_profile_links enable row level security;

drop policy if exists "DV student profiles readable by org members" on public.dv_sd_student_profiles;
create policy "DV student profiles readable by org members"
  on public.dv_sd_student_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_student_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV student profiles writable by org admins and staff" on public.dv_sd_student_profiles;
create policy "DV student profiles writable by org admins and staff"
  on public.dv_sd_student_profiles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_student_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_student_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV parent profiles readable by org members" on public.dv_sd_parent_profiles;
create policy "DV parent profiles readable by org members"
  on public.dv_sd_parent_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV parent profiles writable by org admins and staff" on public.dv_sd_parent_profiles;
create policy "DV parent profiles writable by org admins and staff"
  on public.dv_sd_parent_profiles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_profiles.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV profile links readable by org members" on public.dv_sd_profile_links;
create policy "DV profile links readable by org members"
  on public.dv_sd_profile_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_profile_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV profile links writable by org admins and staff" on public.dv_sd_profile_links;
create policy "DV profile links writable by org admins and staff"
  on public.dv_sd_profile_links
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_profile_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_profile_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );