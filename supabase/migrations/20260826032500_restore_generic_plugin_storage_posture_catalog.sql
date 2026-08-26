-- Keep the reviewed storage posture catalog aligned with the generic plugin
-- bucket introduced by the DVHS CSF 1.1.0 release. The later project-document
-- MIME correction accidentally restored the retired CSF-specific coordinate.
CREATE OR REPLACE FUNCTION app_private.storage_bucket_posture_catalog()
RETURNS TABLE (
  bucket_id text,
  is_public boolean,
  file_size_limit bigint,
  allowed_mime_types text[],
  posture text
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT *
  FROM (
    VALUES
      (
        'avatars'::text,
        true,
        10485760::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'organization-logos'::text,
        true,
        10485760::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'project-images'::text,
        true,
        20971520::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'project-documents'::text,
        true,
        20971520::bigint,
        ARRAY[
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/jpg'
        ]::text[],
        'public'::text
      ),
      (
        'waiver-uploads'::text,
        true,
        20971520::bigint,
        ARRAY['application/pdf']::text[],
        'public'::text
      ),
      (
        'waivers'::text,
        true,
        20971520::bigint,
        ARRAY['application/pdf']::text[],
        'public'::text
      ),
      (
        'plugins'::text,
        false,
        20971520::bigint,
        ARRAY[
          'application/pdf',
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]::text[],
        'server-only'::text
      ),
      (
        'data-exports'::text,
        false,
        52428800::bigint,
        ARRAY['application/zip']::text[],
        'server-only'::text
      ),
      (
        'waiver-signatures'::text,
        false,
        10485760::bigint,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']::text[],
        'server-only'::text
      ),
      (
        'paper-signup-scans'::text,
        false,
        8388608::bigint,
        ARRAY['image/jpeg', 'image/png', 'image/webp']::text[],
        'private-client'::text
      ),
      (
        'plugin_form_uploads'::text,
        false,
        10485760::bigint,
        ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[],
        'private-client'::text
      )
  ) AS catalog(bucket_id, is_public, file_size_limit, allowed_mime_types, posture);
$function$;

COMMENT ON FUNCTION app_private.storage_bucket_posture_catalog() IS
  'Returns the reviewed storage bucket visibility, size, MIME type, and client-access posture contract.';

REVOKE ALL ON FUNCTION app_private.storage_bucket_posture_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.storage_bucket_posture_catalog()
  TO service_role;
