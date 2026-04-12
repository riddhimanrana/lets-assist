-- Phase B: remove duplicate FK indexes introduced by overlapping advisor-hardening migrations.
-- Keep canonical existing idx_* indexes and remove duplicate *_idx variants.

drop index if exists public.account_data_export_jobs_requested_by_idx;
drop index if exists public.banned_emails_banned_by_idx;
drop index if exists public.waiver_definitions_created_by_idx;
