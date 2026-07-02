-- Keep server-managed waiver signature assets in a private bucket.
--
-- This migration is production-safe for existing data:
-- - It does not delete or move objects.
-- - It creates the bucket if missing.
-- - It corrects metadata on conflict so local/remote bucket posture stays
--   reproducible through migrations rather than dashboard-only state.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'waiver-signatures',
  'waiver-signatures',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/jpg']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();
