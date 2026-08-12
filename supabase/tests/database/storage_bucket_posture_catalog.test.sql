-- AUD-009: the storage bucket posture catalog is the single reviewed source for
-- bucket properties and policy-class expectations used by the architecture gate.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

SELECT extensions.results_eq(
  $$
    SELECT
      bucket_id::text COLLATE "C",
      is_public,
      file_size_limit,
      allowed_mime_types,
      posture::text COLLATE "C"
    FROM app_private.storage_bucket_posture_catalog()
    ORDER BY bucket_id
  $$,
  $$
    SELECT
      bucket_id::text COLLATE "C",
      is_public,
      file_size_limit,
      allowed_mime_types,
      posture::text COLLATE "C"
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
          'csf-private'::text,
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
          'organization-logos'::text,
          true,
          10485760::bigint,
          ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
          'public'::text
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
        ),
        (
          'project-documents'::text,
          true,
          20971520::bigint,
          ARRAY['application/pdf']::text[],
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
          'waiver-signatures'::text,
          false,
          10485760::bigint,
          ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']::text[],
          'server-only'::text
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
        )
    ) AS expected(bucket_id, is_public, file_size_limit, allowed_mime_types, posture)
    ORDER BY bucket_id
  $$,
  'storage bucket posture catalog matches the reviewed eleven-bucket baseline'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app_private.storage_bucket_posture_catalog()', 'EXECUTE'),
  'anon cannot execute the storage bucket posture catalog'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.storage_bucket_posture_catalog()',
    'EXECUTE'
  ),
  'authenticated cannot execute the storage bucket posture catalog'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'app_private.storage_bucket_posture_catalog()',
    'EXECUTE'
  ),
  'service_role can execute the storage bucket posture catalog'
);

SELECT extensions.is(
  (
    WITH expected AS (
      SELECT * FROM app_private.storage_bucket_posture_catalog()
    ),
    actual AS (
      SELECT
        b.id AS bucket_id,
        b.public AS is_public,
        b.file_size_limit,
        b.allowed_mime_types
      FROM storage.buckets b
    ),
    drift AS (
      SELECT e.bucket_id
      FROM expected e
      LEFT JOIN actual a ON a.bucket_id = e.bucket_id
      WHERE a.bucket_id IS NULL
         OR e.is_public IS DISTINCT FROM a.is_public
         OR e.file_size_limit IS DISTINCT FROM a.file_size_limit
         OR coalesce(e.allowed_mime_types, array[]::text[])
           IS DISTINCT FROM coalesce(a.allowed_mime_types, array[]::text[])
      UNION
      SELECT a.bucket_id
      FROM actual a
      LEFT JOIN expected e ON e.bucket_id = a.bucket_id
      WHERE e.bucket_id IS NULL
    )
    SELECT count(*) FROM drift
  ),
  0::bigint,
  'live storage buckets match the catalog with no missing, unexpected, or property drift'
);

SELECT extensions.is(
  (
    WITH catalog AS (
      SELECT * FROM app_private.storage_bucket_posture_catalog()
    ),
    server_only_client_policies AS (
      SELECT c.bucket_id, p.policyname
      FROM catalog c
      JOIN pg_policies p
        ON p.schemaname = 'storage'
       AND p.tablename = 'objects'
      WHERE c.posture = 'server-only'
        AND (
          'public' = ANY (p.roles)
          OR 'anon' = ANY (p.roles)
          OR 'authenticated' = ANY (p.roles)
        )
        AND (
          coalesce(p.qual, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
          OR coalesce(p.with_check, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
        )
    )
    SELECT count(*) FROM server_only_client_policies
  ),
  0::bigint,
  'server-only buckets have no client storage.objects policies'
);

SELECT extensions.is(
  (
    WITH catalog AS (
      SELECT * FROM app_private.storage_bucket_posture_catalog()
    ),
    private_client_gaps AS (
      SELECT c.bucket_id
      FROM catalog c
      WHERE c.posture = 'private-client'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_policies p
          WHERE p.schemaname = 'storage'
            AND p.tablename = 'objects'
            AND 'authenticated' = ANY (p.roles)
            AND (
              coalesce(p.qual, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
              OR coalesce(p.with_check, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
            )
        )
      UNION
      SELECT c.bucket_id
      FROM catalog c
      JOIN pg_policies p
        ON p.schemaname = 'storage'
       AND p.tablename = 'objects'
      WHERE c.posture = 'private-client'
        AND (
          'public' = ANY (p.roles)
          OR 'anon' = ANY (p.roles)
        )
        AND (
          coalesce(p.qual, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
          OR coalesce(p.with_check, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
        )
    )
    SELECT count(*) FROM private_client_gaps
  ),
  0::bigint,
  'private-client buckets require authenticated policies and forbid public or anon policies'
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-probe-rogue-bucket',
  'audit-probe-rogue-bucket',
  false,
  1024,
  ARRAY['application/octet-stream']::text[]
);

SELECT extensions.ok(
  EXISTS (
    WITH expected AS (
      SELECT bucket_id FROM app_private.storage_bucket_posture_catalog()
    ),
    actual AS (
      SELECT id AS bucket_id FROM storage.buckets
    )
    SELECT 1
    FROM actual a
    LEFT JOIN expected e ON e.bucket_id = a.bucket_id
    WHERE e.bucket_id IS NULL
  ),
  'a rogue bucket is detected as unexpected catalog drift'
);

CREATE POLICY "audit probe csf-private authenticated leak"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'csf-private');

SELECT extensions.ok(
  EXISTS (
    WITH catalog AS (
      SELECT * FROM app_private.storage_bucket_posture_catalog()
    )
    SELECT 1
    FROM catalog c
    JOIN pg_policies p
      ON p.schemaname = 'storage'
     AND p.tablename = 'objects'
    WHERE c.posture = 'server-only'
      AND c.bucket_id = 'csf-private'
      AND 'authenticated' = ANY (p.roles)
      AND (
        coalesce(p.qual, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
        OR coalesce(p.with_check, '') LIKE ('%bucket_id = ''' || c.bucket_id || '''%')
      )
  ),
  'a server-only authenticated storage policy is detected as posture drift'
);

DROP POLICY "audit probe csf-private authenticated leak" ON storage.objects;

UPDATE storage.buckets
SET public = true
WHERE id = 'data-exports';

SELECT extensions.ok(
  EXISTS (
    WITH expected AS (
      SELECT * FROM app_private.storage_bucket_posture_catalog()
    ),
    actual AS (
      SELECT
        b.id AS bucket_id,
        b.public AS is_public,
        b.file_size_limit,
        b.allowed_mime_types
      FROM storage.buckets b
    )
    SELECT 1
    FROM expected e
    JOIN actual a ON a.bucket_id = e.bucket_id
    WHERE e.is_public IS DISTINCT FROM a.is_public
       OR e.file_size_limit IS DISTINCT FROM a.file_size_limit
       OR coalesce(e.allowed_mime_types, array[]::text[])
         IS DISTINCT FROM coalesce(a.allowed_mime_types, array[]::text[])
  ),
  'a flipped public flag is detected as property drift'
);

UPDATE storage.buckets
SET public = false
WHERE id = 'data-exports';

SELECT * FROM extensions.finish();

ROLLBACK;
