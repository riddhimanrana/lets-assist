-- Keep the data-export bucket at or below the project-wide Storage upload
-- limit. Supabase rejects a bucket configuration whose object limit exceeds
-- the global limit, which prevents preview branch configuration from
-- completing even though migrations have already replayed.

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array['application/zip']::text[],
  public = false,
  updated_at = now()
where id = 'data-exports';
