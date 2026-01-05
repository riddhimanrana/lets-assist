-- Queue table for background processing of project cancellation notifications.
--
-- Assumes pgcrypto extension is available for gen_random_uuid() (default in Supabase).

create table if not exists public.project_cancellation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique,
  cancelled_at timestamptz not null,
  cancellation_reason text not null,
  created_by uuid null,

  status text not null default 'pending',
  cursor integer not null default 0,
  attempts integer not null default 0,
  last_error text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processing_started_at timestamptz null,
  completed_at timestamptz null
);

create index if not exists project_cancellation_jobs_status_created_at_idx
  on public.project_cancellation_jobs (status, created_at);

alter table public.project_cancellation_jobs enable row level security;

-- Intentionally no RLS policies: clients cannot read/write this table.
-- Service role bypasses RLS and is used by the server-side worker.
