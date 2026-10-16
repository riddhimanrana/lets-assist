BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(94);

-- ---------------------------------------------------------------------------
-- Exact execution ACLs: everything added is service-role only
-- ---------------------------------------------------------------------------

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), protected_functions(signature) AS (
  VALUES
    ('public.save_project_waiver_definition_version_checked(uuid, uuid, text, jsonb, jsonb, text, text, uuid)'),
    ('public.confirm_anonymous_signup_with_capacity_checked(uuid, uuid[], uuid[], uuid[])'),
    ('private.lock_waiver_source_object(text)'),
    ('private.waiver_source_path_project_id(text)'),
    ('private.sorted_distinct_uuids(uuid[])'),
    ('private.queue_detached_waiver_source()')
)
SELECT extensions.ok(
  NOT has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
FROM client_roles
CROSS JOIN protected_functions;

SELECT extensions.ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
FROM (
  VALUES
    ('public.save_project_waiver_definition_version_checked(uuid, uuid, text, jsonb, jsonb, text, text, uuid)'),
    ('public.confirm_anonymous_signup_with_capacity_checked(uuid, uuid[], uuid[], uuid[])'),
    ('private.lock_waiver_source_object(text)'),
    ('private.waiver_source_path_project_id(text)'),
    ('private.sorted_distinct_uuids(uuid[])'),
    ('private.queue_detached_waiver_source()')
) AS service_functions(signature);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'waiver_source_object_immutable'
      AND tgrelid = 'storage.objects'::regclass
      AND NOT tgisinternal
  ),
  'the source object protection is installed on storage.objects'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'reject_stale_waiver_evidence'
      AND tgrelid = 'public.waiver_signatures'::regclass
  ),
  'new waiver evidence is rechecked against the project'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'queue_detached_waiver_source'
      AND tgrelid = 'public.projects'::regclass
  ),
  'a detached source is queued by trigger'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'waiver_definition_rendering_inputs_frozen'
      AND tgrelid = 'public.waiver_definitions'::regclass
  ),
  'saved definitions are frozen by trigger'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

SELECT set_config('storage.allow_delete_query', 'true', true);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  ('b1000000-0000-4000-8000-00000000000' || n)::uuid,
  'authenticated', 'authenticated',
  'waiver-boundary-' || n || '@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', 'Boundary Fixture ' || n), now(), now()
FROM generate_series(1, 4) AS n;

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, workflow_status,
  waiver_required, waiver_pdf_storage_path, waiver_pdf_url
)
VALUES
  (
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'Boundary Waiver Project', 'Local', 'Geometry boundary fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-06-01","startTime":"09:00","endTime":"12:00","volunteers":10}}'::jsonb,
    false, 'published', true,
    'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
    'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    'Legacy URL Project', 'Local', 'Geometry boundary fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-06-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true, NULL,
    'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000002/legacy.pdf'
  ),
  (
    'b2000000-0000-4000-8000-000000000003',
    'b1000000-0000-4000-8000-000000000001',
    'Open Project', 'Local', 'Geometry boundary fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-06-01","startTime":"09:00","endTime":"12:00","volunteers":1}}'::jsonb,
    false, 'published', false, NULL, NULL
  ),
  (
    'b2000000-0000-4000-8000-000000000004',
    'b1000000-0000-4000-8000-000000000001',
    'Missing Object Project', 'Local', 'Geometry boundary fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-06-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true,
    'project_waivers/b2000000-0000-4000-8000-000000000004/never-uploaded.pdf',
    NULL
  );

INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES
  ('waiver-uploads',
   'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
   '{"mimetype":"application/pdf","size":100}'::jsonb),
  ('waiver-uploads',
   'project_waivers/b2000000-0000-4000-8000-000000000001/replacement.pdf',
   '{"mimetype":"application/pdf","size":200}'::jsonb),
  ('waiver-uploads',
   'project_waivers/b2000000-0000-4000-8000-000000000001/unreferenced.pdf',
   '{"mimetype":"application/pdf","size":300}'::jsonb),
  ('waiver-uploads',
   'project_waivers/b2000000-0000-4000-8000-000000000002/legacy.pdf',
   '{"mimetype":"application/pdf","size":400}'::jsonb),
  ('waiver-uploads',
   'project_waivers/b2000000-0000-4000-8000-000000000002/other.pdf',
   '{"mimetype":"application/pdf","size":500}'::jsonb);

CREATE OR REPLACE FUNCTION pg_temp.checked_save(
  p_project_id uuid,
  p_expected_path text,
  p_expected_url text,
  p_expected_definition_id uuid,
  p_title text DEFAULT 'Boundary Waiver'
)
RETURNS uuid
LANGUAGE sql
AS $$
  SELECT public.save_project_waiver_definition_version_checked(
    p_project_id,
    'b1000000-0000-4000-8000-000000000001',
    p_title,
    '[{"role_key":"participant","label":"Participant","required":true,"order_index":0}]'::jsonb,
    '[{"field_key":"signature","field_type":"signature","page_index":0,"rect":{"x":10,"y":10,"width":100,"height":30},"signer_role_key":"participant"}]'::jsonb,
    p_expected_path,
    p_expected_url,
    p_expected_definition_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Definition save is compare-and-set against the validated snapshot
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE first_definition AS
SELECT pg_temp.checked_save(
  'b2000000-0000-4000-8000-000000000001',
  'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
  'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
  NULL
) AS id;

SELECT extensions.ok(
  (SELECT id IS NOT NULL FROM first_definition),
  'a save whose expected snapshot matches creates a definition, with a NULL current definition compared null-safely'
);

SELECT extensions.is(
  (
    SELECT waiver_definition_id
    FROM public.projects
    WHERE id = 'b2000000-0000-4000-8000-000000000001'
  ),
  (SELECT id FROM first_definition),
  'the checked save repoints the project through the existing version RPC'
);

-- The same request replayed: the project now has a definition the caller did
-- not see, exactly as if another save had won the race.
SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.checked_save(
      'b2000000-0000-4000-8000-000000000001',
      'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
      'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
      NULL
    )
  $$,
  '40001',
  'the waiver source or definition changed during the save',
  'a save against a superseded definition is refused'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT pg_temp.checked_save(
        'b2000000-0000-4000-8000-000000000001',
        'project_waivers/b2000000-0000-4000-8000-000000000001/replacement.pdf',
        'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
        %L
      )
    $sql$,
    (SELECT id FROM first_definition)
  ),
  '40001',
  'the waiver source or definition changed during the save',
  'a save validated against a different source path is refused'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT pg_temp.checked_save(
        'b2000000-0000-4000-8000-000000000001',
        'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
        NULL,
        %L
      )
    $sql$,
    (SELECT id FROM first_definition)
  ),
  '40001',
  'the waiver source or definition changed during the save',
  'a NULL expected URL does not match a project that has one'
);

SELECT extensions.throws_ok(
  $$
    SELECT pg_temp.checked_save(
      'b2000000-0000-4000-8000-000000000004',
      'project_waivers/b2000000-0000-4000-8000-000000000004/never-uploaded.pdf',
      NULL,
      NULL
    )
  $$,
  '40001',
  'the waiver source or definition changed during the save',
  'a save whose validated source object no longer exists is refused'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_definitions
    WHERE project_id IN (
      'b2000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000004'
    )
  ),
  1::bigint,
  'no refused save created a definition version'
);

CREATE TEMP TABLE second_definition AS
SELECT pg_temp.checked_save(
  'b2000000-0000-4000-8000-000000000001',
  'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
  'https://project.supabase.co/storage/v1/object/public/waiver-uploads/project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
  (SELECT id FROM first_definition),
  'Boundary Waiver Revised'
) AS id;

SELECT extensions.is(
  (
    SELECT version
    FROM public.waiver_definitions
    WHERE id = (SELECT id FROM second_definition)
  ),
  2,
  'a save against the current definition creates the next version'
);

-- ---------------------------------------------------------------------------
-- A saved definition is frozen, signed or not
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  format(
    'UPDATE public.waiver_definitions SET title = %L WHERE id = %L',
    'Edited in place',
    (SELECT id FROM second_definition)
  ),
  '22023',
  'saved waiver definitions are immutable',
  'an unsigned definition title cannot be edited in place'
);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.waiver_definitions SET fields = %L::jsonb WHERE id = %L',
    '[{"field_key":"signature","field_type":"signature","page_index":7,"rect":{"x":10,"y":10,"width":100,"height":30},"signer_role_key":"participant"}]',
    (SELECT id FROM second_definition)
  ),
  '22023',
  'saved waiver definitions are immutable',
  'an unsigned definition placement cannot be moved in place'
);

SELECT extensions.throws_ok(
  format(
    'UPDATE public.waiver_definitions SET pdf_storage_path = %L WHERE id = %L',
    'project_waivers/b2000000-0000-4000-8000-000000000001/replacement.pdf',
    (SELECT id FROM second_definition)
  ),
  '22023',
  'saved waiver definitions are immutable',
  'an unsigned definition cannot be repointed at another source'
);

SELECT extensions.lives_ok(
  format(
    'UPDATE public.waiver_definitions SET active = NOT active, updated_at = now() WHERE id = %L',
    (SELECT id FROM first_definition)
  ),
  'version bookkeeping (active, updated_at) may still change'
);

SELECT extensions.lives_ok(
  format(
    'UPDATE public.waiver_definitions SET created_by = NULL WHERE id = %L',
    (SELECT id FROM first_definition)
  ),
  'the creator link of an unsigned definition can still be cleared'
);

-- ---------------------------------------------------------------------------
-- A referenced source object cannot be overwritten, moved, or deleted
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    UPDATE storage.objects
    SET metadata = '{"mimetype":"application/pdf","size":999}'::jsonb
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot be overwritten'
);

SELECT extensions.throws_ok(
  $$
    UPDATE storage.objects
    SET name = 'project_waivers/b2000000-0000-4000-8000-000000000001/moved.pdf'
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot be renamed'
);

SELECT extensions.throws_ok(
  $$
    UPDATE storage.objects
    SET bucket_id = 'waiver-signatures'
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot be moved to another bucket'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot be deleted'
);

SELECT extensions.lives_ok(
  $$
    UPDATE storage.objects
    SET last_accessed_at = now()
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  'an access-time-only write to a referenced source is not a content change'
);

-- Generated columns are computed after BEFORE triggers, so the protection
-- must not read their missing NEW values as a change. Every ordinary column
-- other than the two timestamps stays fenced.
CREATE TEMP TABLE referenced_source_before AS
SELECT to_jsonb(objects) - ARRAY['last_accessed_at', 'updated_at']::text[] AS fenced
FROM storage.objects AS objects
WHERE bucket_id = 'waiver-uploads'
  AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf';

CREATE OR REPLACE FUNCTION pg_temp.referenced_source_fenced()
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT to_jsonb(objects) - ARRAY['last_accessed_at', 'updated_at']::text[]
  FROM storage.objects AS objects
  WHERE bucket_id = 'waiver-uploads'
    AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf';
$$;

CREATE OR REPLACE FUNCTION pg_temp.referenced_source_update(p_set text)
RETURNS text
LANGUAGE sql
AS $$
  SELECT format(
    'UPDATE storage.objects SET %s WHERE bucket_id = %L AND name = %L',
    p_set,
    'waiver-uploads',
    'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  );
$$;

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'storage.objects'::regclass
      AND attnum > 0
      AND NOT attisdropped
      AND attgenerated <> ''
  ),
  'storage.objects has a generated column, so these writes exercise recomputation'
);

SELECT extensions.lives_ok(
  pg_temp.referenced_source_update('name = name, metadata = metadata'),
  'a write that changes no column of a referenced source passes'
);

SELECT extensions.lives_ok(
  pg_temp.referenced_source_update(
    $$last_accessed_at = '2099-01-01T00:00:00Z', updated_at = '2099-01-01T00:00:00Z'$$
  ),
  'a write that changes only the two timestamps of a referenced source passes'
);

SELECT extensions.is(
  (
    SELECT last_accessed_at
    FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  '2099-01-01T00:00:00Z'::timestamptz,
  'the access-time write was stored, not skipped'
);

SELECT extensions.is(
  pg_temp.referenced_source_fenced(),
  (SELECT fenced FROM referenced_source_before),
  'the permitted writes left every ordinary and recomputed generated value as it was'
);

SELECT extensions.throws_ok(
  pg_temp.referenced_source_update(
    $$version = 'b4000000-0000-4000-8000-000000000004'$$
  ),
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot be given a new version'
);

SELECT extensions.throws_ok(
  pg_temp.referenced_source_update(
    $$owner_id = 'b1000000-0000-4000-8000-000000000002'$$
  ),
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot change owner'
);

SELECT extensions.throws_ok(
  pg_temp.referenced_source_update($$user_metadata = '{"replaced":true}'::jsonb$$),
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a referenced source cannot have its user metadata rewritten'
);

SELECT extensions.throws_ok(
  pg_temp.referenced_source_update(
    $$last_accessed_at = now(), updated_at = now(), metadata = '{"mimetype":"application/pdf","size":999}'::jsonb$$
  ),
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a timestamp write that also changes content is refused'
);

SELECT extensions.throws_ok(
  pg_temp.referenced_source_update(
    $$last_accessed_at = now(), name = 'project_waivers/b2000000-0000-4000-8000-000000000001/moved.pdf'$$
  ),
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a timestamp write that also moves the object is refused'
);

SELECT extensions.is(
  pg_temp.referenced_source_fenced(),
  (SELECT fenced FROM referenced_source_before),
  'no refused write changed the referenced source'
);

SELECT extensions.lives_ok(
  $$
    UPDATE storage.objects
    SET metadata = '{"mimetype":"application/pdf","size":301}'::jsonb
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/unreferenced.pdf'
  $$,
  'an unreferenced object in the same bucket can still be rewritten'
);

SELECT extensions.lives_ok(
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/unreferenced.pdf'
  $$,
  'unreferenced cleanup is still allowed'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/unreferenced.pdf'
  ),
  0::bigint,
  'the unreferenced object is gone'
);

-- A project that predates source paths names its object by public URL.
SELECT extensions.ok(
  private.waiver_source_path_is_referenced(
    'project_waivers/b2000000-0000-4000-8000-000000000002/legacy.pdf'
  ),
  'a legacy public URL under the project prefix counts as a reference'
);

SELECT extensions.ok(
  NOT private.waiver_source_path_is_referenced(
    'project_waivers/b2000000-0000-4000-8000-000000000001/legacy.pdf'
  ),
  'the same file name under another project is not that reference'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000002/legacy.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'a source named only by a legacy URL is not stranded'
);

SELECT extensions.lives_ok(
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000002/other.pdf'
  $$,
  'another object of the legacy project stays removable'
);

-- ---------------------------------------------------------------------------
-- New evidence never binds a superseded definition or source
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.signed_waiver(
  p_definition_id uuid,
  p_source_path text,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'signer_name', 'Boundary Signer',
    'signer_email', 'boundary-signer@local.test',
    'signature_type', 'typed',
    'signature_text', 'Boundary Signer',
    'waiver_definition_id', p_definition_id,
    'waiver_pdf_storage_path', p_source_path
  )) || p_extra;
$$;

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.insert_project_signup_with_waiver(
        'b2000000-0000-4000-8000-000000000001', 'oneTime',
        'b1000000-0000-4000-8000-000000000002', NULL, 'approved', NULL, NULL,
        pg_temp.signed_waiver(
          %L,
          'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
        ),
        NULL
      )
    $sql$,
    (SELECT id FROM first_definition)
  ),
  '23514',
  'waiver evidence names a superseded waiver definition',
  'evidence prepared against a superseded definition is refused'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'b2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the refused evidence rolled its whole signup transaction back'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.insert_project_signup_with_waiver(
        'b2000000-0000-4000-8000-000000000001', 'oneTime',
        'b1000000-0000-4000-8000-000000000002', NULL, 'approved', NULL, NULL,
        pg_temp.signed_waiver(
          %L,
          'project_waivers/b2000000-0000-4000-8000-000000000001/replacement.pdf'
        ),
        NULL
      )
    $sql$,
    (SELECT id FROM second_definition)
  ),
  '23514',
  'waiver evidence names a superseded waiver source document',
  'evidence prepared against a different source document is refused'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures
    WHERE project_id = 'b2000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'no refused evidence row was written'
);

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.insert_project_signup_with_waiver(
      'b2000000-0000-4000-8000-000000000001', 'oneTime',
      'b1000000-0000-4000-8000-000000000002', NULL, 'approved', NULL, NULL,
      pg_temp.signed_waiver(
        (SELECT id FROM second_definition),
        'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
      ),
      NULL
    )
  ),
  'inserted',
  'evidence that names the current definition and source is accepted'
);

SELECT extensions.is(
  (
    SELECT waiver_definition_id
    FROM public.waiver_signatures
    WHERE project_id = 'b2000000-0000-4000-8000-000000000001'
      AND user_id = 'b1000000-0000-4000-8000-000000000002'
  ),
  (SELECT id FROM second_definition),
  'the accepted evidence keeps its definition snapshot'
);

-- A full signed copy uploaded by the volunteer keeps its own semantics.
SELECT extensions.is(
  (
    SELECT outcome
    FROM public.insert_project_signup_with_waiver(
      'b2000000-0000-4000-8000-000000000001', 'oneTime',
      'b1000000-0000-4000-8000-000000000003', NULL, 'approved', NULL, NULL,
      pg_temp.signed_waiver(
        (SELECT id FROM second_definition),
        'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf',
        '{"signature_type":"upload","signature_text":null,"upload_storage_path":"signed-waivers/fixture/boundary.pdf"}'::jsonb
      ),
      NULL
    )
  ),
  'inserted',
  'an uploaded signed copy is still accepted'
);

-- The comparison is null-safe: a missing snapshot is not current provenance.
SELECT extensions.throws_ok(
  $$
    SELECT public.insert_project_signup_with_waiver(
      'b2000000-0000-4000-8000-000000000001', 'oneTime',
      'b1000000-0000-4000-8000-000000000004', NULL, 'approved', NULL, NULL,
      pg_temp.signed_waiver(NULL, NULL),
      NULL
    )
  $$,
  '23514',
  'waiver evidence names a superseded waiver definition',
  'evidence with no definition is refused on a project that has one'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      SELECT public.insert_project_signup_with_waiver(
        'b2000000-0000-4000-8000-000000000001', 'oneTime',
        'b1000000-0000-4000-8000-000000000004', NULL, 'approved', NULL, NULL,
        pg_temp.signed_waiver(%L, NULL),
        NULL
      )
    $sql$,
    (SELECT id FROM second_definition)
  ),
  '23514',
  'waiver evidence names a superseded waiver source document',
  'evidence with no source snapshot is refused on a project that has a source'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'b2000000-0000-4000-8000-000000000001'
      AND user_id = 'b1000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'neither refusal left a signup behind'
);

-- A snapshot of an object that does not exist proves nothing.
INSERT INTO public.project_signups (
  id, project_id, schedule_id, status, user_id
)
VALUES (
  'b5000000-0000-4000-8000-000000000008',
  'b2000000-0000-4000-8000-000000000004', 'missing-slot', 'approved',
  'b1000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.waiver_signatures (
      project_id, signup_id, user_id, signer_name, signer_email,
      signature_type, signature_text, waiver_pdf_storage_path
    )
    VALUES (
      'b2000000-0000-4000-8000-000000000004',
      'b5000000-0000-4000-8000-000000000008',
      'b1000000-0000-4000-8000-000000000001',
      'Missing Source', 'missing-source@local.test', 'typed', 'Missing Source',
      'project_waivers/b2000000-0000-4000-8000-000000000004/never-uploaded.pdf'
    )
  $$,
  '23514',
  'waiver evidence names a waiver source document that does not exist',
  'evidence naming a source object that does not exist is refused'
);

-- ---------------------------------------------------------------------------
-- Guest confirmation promotes exactly what was checked
-- ---------------------------------------------------------------------------

INSERT INTO public.anonymous_signups (id, project_id, email, name, token)
VALUES
  ('b3000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000003',
   'boundary-guest-1@local.test', 'Boundary Guest 1',
   'b4000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000003',
   'boundary-guest-2@local.test', 'Boundary Guest 2',
   'b4000000-0000-4000-8000-000000000002'),
  ('b3000000-0000-4000-8000-000000000003',
   'b2000000-0000-4000-8000-000000000001',
   'boundary-guest-3@local.test', 'Boundary Guest 3',
   'b4000000-0000-4000-8000-000000000003'),
  ('b3000000-0000-4000-8000-000000000004',
   'b2000000-0000-4000-8000-000000000001',
   'boundary-guest-4@local.test', 'Boundary Guest 4',
   'b4000000-0000-4000-8000-000000000004');

SELECT public.insert_project_signup_with_capacity(
  'b2000000-0000-4000-8000-000000000003', 'oneTime', NULL,
  guest_id, 'pending', NULL, NULL
)
FROM (
  VALUES
    ('b3000000-0000-4000-8000-000000000001'::uuid),
    ('b3000000-0000-4000-8000-000000000002'::uuid)
) AS guests(guest_id);

CREATE OR REPLACE FUNCTION pg_temp.pending_ids(p_anonymous_id uuid)
RETURNS uuid[]
LANGUAGE sql
AS $$
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  FROM public.project_signups
  WHERE anonymous_id = p_anonymous_id AND status = 'pending';
$$;

CREATE OR REPLACE FUNCTION pg_temp.confirm_checked(
  p_anonymous_id uuid,
  p_signup_ids uuid[],
  p_waiver_signup_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_signature_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS text
LANGUAGE sql
AS $$
  SELECT outcome
  FROM public.confirm_anonymous_signup_with_capacity_checked(
    p_anonymous_id, p_signup_ids, p_waiver_signup_ids, p_signature_ids
  );
$$;

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000001', ARRAY[]::uuid[]
  ),
  'pending_signups_changed',
  'a pending signup the server never checked blocks the whole confirmation'
);

SELECT extensions.ok(
  (
    SELECT anonymous.confirmed_at IS NULL
      AND pg_temp.pending_ids(anonymous.id) <> ARRAY[]::uuid[]
    FROM public.anonymous_signups AS anonymous
    WHERE anonymous.id = 'b3000000-0000-4000-8000-000000000001'
  ),
  'the refused confirmation changed neither the profile nor the signup'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000001',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000001')
  ),
  'confirmed',
  'a project without a waiver confirms with an exact checked set'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000001', ARRAY[]::uuid[]
  ),
  'already_confirmed',
  'a replay with nothing pending stays idempotent'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000002',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000002')
  ),
  'slot_full',
  'the capacity routine still decides a full slot'
);

SELECT extensions.ok(
  (
    SELECT confirmed_at IS NULL
    FROM public.anonymous_signups
    WHERE id = 'b3000000-0000-4000-8000-000000000002'
  ),
  'a full slot still leaves the profile unconfirmed'
);

-- The waiver requirement is switched on after the server's check. The
-- pending signup was never checked as a waiver signup, so it is not promoted,
-- and telling the transaction about the requirement does not help either:
-- there is no evidence to have checked.
UPDATE public.projects
SET waiver_required = true
WHERE id = 'b2000000-0000-4000-8000-000000000003';

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000002',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000002')
  ),
  'pending_signups_changed',
  'a waiver requirement enabled after the check blocks confirmation'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000002',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000002'),
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000002')
  ),
  'waiver_evidence_missing',
  'a newly required waiver with no evidence is never promoted'
);

SELECT extensions.ok(
  (
    SELECT anonymous.confirmed_at IS NULL
      AND cardinality(pg_temp.pending_ids(anonymous.id)) = 1
    FROM public.anonymous_signups AS anonymous
    WHERE anonymous.id = 'b3000000-0000-4000-8000-000000000002'
  ),
  'neither refusal changed the profile or the signup'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-0000000000ff', ARRAY[]::uuid[]
  ),
  'not_found',
  'an unknown profile is reported, not confirmed'
);

SELECT extensions.is(
  pg_temp.confirm_checked('b3000000-0000-4000-8000-000000000001', NULL),
  'invalid_input',
  'a missing checked set is refused'
);

-- A guest on the waiver project, with evidence for the current waiver.
SELECT public.insert_project_signup_with_waiver(
  'b2000000-0000-4000-8000-000000000001', 'oneTime', NULL,
  'b3000000-0000-4000-8000-000000000003', 'pending', NULL, NULL,
  pg_temp.signed_waiver(
    (SELECT id FROM second_definition),
    'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  NULL
);

CREATE OR REPLACE FUNCTION pg_temp.signature_ids(p_anonymous_id uuid)
RETURNS uuid[]
LANGUAGE sql
AS $$
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  FROM public.waiver_signatures
  WHERE anonymous_id = p_anonymous_id;
$$;

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000003',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003')
  ),
  'pending_signups_changed',
  'a waiver requirement the server did not check blocks confirmation'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000003',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    ARRAY['b5000000-0000-4000-8000-0000000000ff'::uuid]
  ),
  'pending_signups_changed',
  'evidence other than the rows the server judged blocks confirmation'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000003',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.signature_ids('b3000000-0000-4000-8000-000000000003')
      || 'b5000000-0000-4000-8000-0000000000ff'::uuid
  ),
  'pending_signups_changed',
  'an evidence id the database does not have blocks confirmation'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000003',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003')
      || 'b5000000-0000-4000-8000-0000000000ff'::uuid,
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.signature_ids('b3000000-0000-4000-8000-000000000003')
  ),
  'pending_signups_changed',
  'a signup id that is no longer pending blocks confirmation'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.project_signups
    WHERE anonymous_id = 'b3000000-0000-4000-8000-000000000003'
  ),
  'pending',
  'neither refusal promoted the waiver signup'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000003',
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.pending_ids('b3000000-0000-4000-8000-000000000003'),
    pg_temp.signature_ids('b3000000-0000-4000-8000-000000000003')
  ),
  'confirmed',
  'an exact signup, requirement, and evidence match confirms'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.project_signups
    WHERE anonymous_id = 'b3000000-0000-4000-8000-000000000003'
  ),
  'approved',
  'the checked waiver signup is promoted'
);

-- A waiver-required pending signup that has no evidence at all.
INSERT INTO public.project_signups (
  id, project_id, schedule_id, status, anonymous_id
)
VALUES (
  'b5000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000001',
  'oneTime', 'pending',
  'b3000000-0000-4000-8000-000000000004'
);

SELECT extensions.is(
  pg_temp.confirm_checked(
    'b3000000-0000-4000-8000-000000000004',
    ARRAY['b5000000-0000-4000-8000-000000000004'::uuid],
    ARRAY['b5000000-0000-4000-8000-000000000004'::uuid]
  ),
  'waiver_evidence_missing',
  'a waiver-required signup with no evidence is never promoted'
);

SELECT extensions.is(
  (
    SELECT status
    FROM public.project_signups
    WHERE id = 'b5000000-0000-4000-8000-000000000004'
  ),
  'pending',
  'the signup without evidence stays pending'
);

-- ---------------------------------------------------------------------------
-- Replacing the source leaves historical evidence and its document alone
-- ---------------------------------------------------------------------------

UPDATE public.projects
SET waiver_pdf_storage_path =
      'project_waivers/b2000000-0000-4000-8000-000000000001/replacement.pdf',
    waiver_pdf_url = NULL
WHERE id = 'b2000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_signatures
    WHERE project_id = 'b2000000-0000-4000-8000-000000000001'
      AND waiver_pdf_storage_path =
        'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  3::bigint,
  'historical evidence still names the document it was signed against'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_storage_deletion_queue
    WHERE object_path =
      'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  0::bigint,
  'a replaced source that evidence still names is not queued for deletion'
);

-- A draft drops a waiver document nothing else names. The detach itself
-- leaves the cleanup record, so no later step can lose it.
UPDATE public.projects
SET waiver_pdf_storage_path = NULL
WHERE id = 'b2000000-0000-4000-8000-000000000004';

SELECT extensions.is(
  (
    SELECT bucket_id
    FROM public.waiver_storage_deletion_queue
    WHERE object_path =
      'project_waivers/b2000000-0000-4000-8000-000000000004/never-uploaded.pdf'
  ),
  'waiver-uploads',
  'detaching an unreferenced source queues it in the same transaction'
);

SELECT extensions.throws_ok(
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'waiver-uploads'
      AND name = 'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
  $$,
  '23503',
  'a referenced waiver source document cannot be changed or deleted',
  'the superseded source stays protected while evidence names it'
);

INSERT INTO public.project_signups (
  id, project_id, schedule_id, status, user_id
)
VALUES (
  'b5000000-0000-4000-8000-000000000009',
  'b2000000-0000-4000-8000-000000000001', 'late-slot', 'approved',
  'b1000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  format(
    $sql$
      INSERT INTO public.waiver_signatures (
        project_id, signup_id, user_id, signer_name, signer_email,
        signature_type, signature_text, waiver_definition_id,
        waiver_pdf_storage_path
      )
      VALUES (
        'b2000000-0000-4000-8000-000000000001',
        'b5000000-0000-4000-8000-000000000009',
        'b1000000-0000-4000-8000-000000000001',
        'Late Signer', 'late-signer@local.test', 'typed', 'Late Signer',
        %L,
        'project_waivers/b2000000-0000-4000-8000-000000000001/source.pdf'
      )
    $sql$,
    (SELECT id FROM second_definition)
  ),
  '23514',
  'waiver evidence names a superseded waiver source document',
  'new evidence cannot bind the document the project has replaced'
);

SELECT * FROM extensions.finish();

ROLLBACK;
