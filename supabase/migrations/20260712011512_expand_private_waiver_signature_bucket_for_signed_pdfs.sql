-- Full signed-waiver uploads now share the private server-only signature bucket
-- with signature images. This metadata-only upsert does not move/delete objects.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'waiver-signatures',
  'waiver-signatures',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

COMMENT ON COLUMN public.waiver_signatures.upload_storage_path IS
  'Private object path in the waiver-signatures bucket for a full signed waiver upload (PDF or image); never a public URL.';
