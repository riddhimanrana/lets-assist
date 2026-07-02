-- Keep app storage buckets as database baseline, not only local CLI config.
--
-- Public buckets are used only for object delivery. Object listing remains
-- controlled by storage.objects RLS policies, and uploads/deletes are scoped by
-- authenticated policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    true,
    10485760,
    ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]
  ),
  (
    'organization-logos',
    'organization-logos',
    true,
    10485760,
    ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]
  ),
  (
    'project-images',
    'project-images',
    true,
    20971520,
    ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]
  ),
  (
    'project-documents',
    'project-documents',
    true,
    20971520,
    ARRAY['application/pdf']::text[]
  ),
  (
    'waiver-uploads',
    'waiver-uploads',
    true,
    20971520,
    ARRAY['application/pdf']::text[]
  ),
  (
    'waivers',
    'waivers',
    true,
    20971520,
    ARRAY['application/pdf']::text[]
  ),
  (
    'data-exports',
    'data-exports',
    false,
    104857600,
    ARRAY['application/zip']::text[]
  ),
  (
    'plugin_form_uploads',
    'plugin_form_uploads',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();
