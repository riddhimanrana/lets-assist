-- DV Speech & Debate example plugin schema
-- This migration provides a reference custom-plugin data model that is organization-scoped.

create table if not exists public.dv_sd_tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  entries_count integer not null default 0,
  entries_per_judge integer not null default 6,
  judges_required_override integer,
  tabroom_tournament_id text,
  schedule_config jsonb not null default '{}'::jsonb,
  is_draft boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (entries_count >= 0),
  check (entries_per_judge > 0),
  check (judges_required_override is null or judges_required_override > 0)
);

create table if not exists public.dv_sd_signup_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tournament_id uuid references public.dv_sd_tournaments(id) on delete set null,
  title text not null,
  signup_type text not null check (signup_type in ('student', 'parent_judge')),
  collect_partner_name boolean not null default true,
  collect_membership_receipt boolean not null default false,
  sync_to_google_sheet boolean not null default false,
  target_sheet_id text,
  is_active boolean not null default true,
  is_draft boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.dv_sd_signup_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  form_id uuid not null references public.dv_sd_signup_forms(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'textarea', 'select', 'checkbox', 'number', 'email', 'phone', 'file')),
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (form_id, field_key)
);

create table if not exists public.dv_sd_signup_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  form_id uuid not null references public.dv_sd_signup_forms(id) on delete cascade,
  tournament_id uuid references public.dv_sd_tournaments(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  participant_type text not null check (participant_type in ('student', 'parent')),
  student_profile_id uuid references public.profiles(id) on delete set null,
  student_name text,
  parent_name text,
  email text,
  phone text,
  partner_name text,
  wants_parent_to_judge boolean not null default false,
  judge_days jsonb not null default '[]'::jsonb,
  paid_membership boolean not null default false,
  membership_receipt_url text,
  notes text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'error')),
  sync_error text,
  synced_sheet_row_ref text,
  tabroom_points integer not null default 0,
  submitted_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.dv_sd_submission_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null references public.dv_sd_signup_submissions(id) on delete cascade,
  question_id uuid not null references public.dv_sd_signup_questions(id) on delete cascade,
  answer_text text,
  answer_json jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (submission_id, question_id)
);

create table if not exists public.dv_sd_parent_student_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_profile_id uuid references public.profiles(id) on delete set null,
  student_name text not null,
  parent_name text not null,
  parent_email text,
  parent_phone text,
  relationship text default 'parent',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.dv_sd_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_profile_id uuid references public.profiles(id) on delete set null,
  student_name text not null,
  membership_paid boolean not null default false,
  membership_receipt_url text,
  times_competed integer not null default 0,
  times_judged integer not null default 0,
  source_type text not null default 'manual' check (source_type in ('manual', 'sheet_import', 'api_sync')),
  source_reference text,
  imported_at timestamp with time zone,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (times_competed >= 0),
  check (times_judged >= 0)
);

create table if not exists public.dv_sd_judge_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tournament_id uuid references public.dv_sd_tournaments(id) on delete set null,
  assignment_date date not null,
  event_name text not null,
  parent_link_id uuid references public.dv_sd_parent_student_links(id) on delete set null,
  submission_id uuid references public.dv_sd_signup_submissions(id) on delete set null,
  assigned_parent_name text,
  assigned_parent_email text,
  status text not null default 'assigned' check (status in ('assigned', 'confirmed', 'cancelled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_dv_sd_tournaments_org
  on public.dv_sd_tournaments (organization_id);

create index if not exists idx_dv_sd_forms_org
  on public.dv_sd_signup_forms (organization_id);

create index if not exists idx_dv_sd_questions_org
  on public.dv_sd_signup_questions (organization_id);

create index if not exists idx_dv_sd_submissions_org
  on public.dv_sd_signup_submissions (organization_id);

create index if not exists idx_dv_sd_answers_org
  on public.dv_sd_submission_answers (organization_id);

create index if not exists idx_dv_sd_links_org
  on public.dv_sd_parent_student_links (organization_id);

create index if not exists idx_dv_sd_memberships_org
  on public.dv_sd_memberships (organization_id);

create index if not exists idx_dv_sd_assignments_org
  on public.dv_sd_judge_assignments (organization_id);

alter table public.dv_sd_tournaments enable row level security;
alter table public.dv_sd_signup_forms enable row level security;
alter table public.dv_sd_signup_questions enable row level security;
alter table public.dv_sd_signup_submissions enable row level security;
alter table public.dv_sd_submission_answers enable row level security;
alter table public.dv_sd_parent_student_links enable row level security;
alter table public.dv_sd_memberships enable row level security;
alter table public.dv_sd_judge_assignments enable row level security;

drop policy if exists "DV tournaments readable by org members" on public.dv_sd_tournaments;
create policy "DV tournaments readable by org members"
  on public.dv_sd_tournaments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_tournaments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV tournaments writable by org admins and staff" on public.dv_sd_tournaments;
create policy "DV tournaments writable by org admins and staff"
  on public.dv_sd_tournaments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_tournaments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_tournaments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV forms readable by org members" on public.dv_sd_signup_forms;
create policy "DV forms readable by org members"
  on public.dv_sd_signup_forms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_forms.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV forms writable by org admins and staff" on public.dv_sd_signup_forms;
create policy "DV forms writable by org admins and staff"
  on public.dv_sd_signup_forms
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_forms.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_forms.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV questions readable by org members" on public.dv_sd_signup_questions;
create policy "DV questions readable by org members"
  on public.dv_sd_signup_questions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_questions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV questions writable by org admins and staff" on public.dv_sd_signup_questions;
create policy "DV questions writable by org admins and staff"
  on public.dv_sd_signup_questions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_questions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_questions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV submissions readable by org members" on public.dv_sd_signup_submissions;
create policy "DV submissions readable by org members"
  on public.dv_sd_signup_submissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_submissions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV submissions writable by org admins and staff" on public.dv_sd_signup_submissions;
create policy "DV submissions writable by org admins and staff"
  on public.dv_sd_signup_submissions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_submissions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_signup_submissions.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV answers readable by org members" on public.dv_sd_submission_answers;
create policy "DV answers readable by org members"
  on public.dv_sd_submission_answers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_submission_answers.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV answers writable by org admins and staff" on public.dv_sd_submission_answers;
create policy "DV answers writable by org admins and staff"
  on public.dv_sd_submission_answers
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_submission_answers.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_submission_answers.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV parent links readable by org members" on public.dv_sd_parent_student_links;
create policy "DV parent links readable by org members"
  on public.dv_sd_parent_student_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_student_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV parent links writable by org admins and staff" on public.dv_sd_parent_student_links;
create policy "DV parent links writable by org admins and staff"
  on public.dv_sd_parent_student_links
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_student_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_parent_student_links.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV memberships readable by org members" on public.dv_sd_memberships;
create policy "DV memberships readable by org members"
  on public.dv_sd_memberships
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_memberships.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV memberships writable by org admins and staff" on public.dv_sd_memberships;
create policy "DV memberships writable by org admins and staff"
  on public.dv_sd_memberships
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_memberships.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_memberships.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

drop policy if exists "DV judge assignments readable by org members" on public.dv_sd_judge_assignments;
create policy "DV judge assignments readable by org members"
  on public.dv_sd_judge_assignments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_judge_assignments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff', 'member'])
    )
  );

drop policy if exists "DV judge assignments writable by org admins and staff" on public.dv_sd_judge_assignments;
create policy "DV judge assignments writable by org admins and staff"
  on public.dv_sd_judge_assignments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_judge_assignments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = dv_sd_judge_assignments.organization_id
        and om.user_id = auth.uid()
        and om.role = any (array['admin', 'staff'])
    )
  );

insert into public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  force_update_version,
  private_codebase,
  code_repository,
  code_reference,
  metadata,
  updated_at
)
values (
  'dv-speech-debate',
  'DV Speech & Debate Ops',
  'Custom signup forms, parent judge workflows, membership receipts, and tournament staffing for DV Speech & Debate.',
  'private',
  true,
  '0.1.0',
  null,
  true,
  'private://dv-speech-debate-plugin',
  'main',
  jsonb_build_object('example_plugin', true),
  now()
)
on conflict (key)
do update
set
  name = excluded.name,
  description = excluded.description,
  visibility = excluded.visibility,
  is_active = excluded.is_active,
  latest_version = excluded.latest_version,
  private_codebase = excluded.private_codebase,
  code_repository = excluded.code_repository,
  code_reference = excluded.code_reference,
  metadata = coalesce(public.plugins.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();