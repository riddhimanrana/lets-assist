-- Organization Google Sheets sync configuration
create table if not exists organization_sheet_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references profiles(id) on delete set null,
  sheet_id text not null,
  sheet_url text not null,
  tab_name text not null default 'Member Hours',
  report_type text not null default 'member-hours',
  auto_sync boolean not null default false,
  sync_interval_minutes integer not null default 1440,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_sheet_syncs_org_id_idx
  on organization_sheet_syncs (organization_id);