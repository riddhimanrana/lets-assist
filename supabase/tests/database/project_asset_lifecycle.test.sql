-- Project files are removed only through recorded ownership and a deletion
-- claim. Shared files outlive either project, and the last linker releases them.
--
-- These statements run one after another in a single session. They prove what
-- each trigger and function refuses. They do not prove lock ordering or what
-- two concurrent sessions do; that needs the isolated two-session replay.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(73);

-- Newer Storage versions refuse direct catalog deletes unless this is set.
-- The deletes below stand in for the Storage API removing an object.
SET LOCAL storage.allow_delete_query = 'true';

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  ('a8000000-0000-4000-8000-00000000000' || fixture.suffix)::uuid,
  'authenticated', 'authenticated',
  'asset-lifecycle-' || fixture.label || '@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
FROM (VALUES ('1', 'creator'), ('2', 'stranger'), ('3', 'admin')) AS fixture(suffix, label);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('a8100000-0000-4000-8000-000000000001', 'Asset Lifecycle Org',
        'asset-lifecycle-org', 'nonprofit', '787001');
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('a8100000-0000-4000-8000-000000000001',
        'a8000000-0000-4000-8000-000000000003', 'admin', 'active');

-- 1 source, 3 unlinked upload, 4 forged links, 5 signed waiver, 6 owner removed
-- outside the reviewed path, 7 links 6's file, 8 organization project, 9 direct
-- removal. The clone (2) is inserted later with the source's links.
INSERT INTO public.projects (
  id, creator_id, organization_id, title, location, description, event_type,
  verification_method, schedule, require_login
)
SELECT
  ('a8200000-0000-4000-8000-00000000000' || fixture.suffix)::uuid,
  'a8000000-0000-4000-8000-000000000001',
  CASE WHEN fixture.suffix = '8' THEN 'a8100000-0000-4000-8000-000000000001'::uuid END,
  'Asset lifecycle ' || fixture.suffix, 'Local', 'Synthetic', 'oneTime', 'manual',
  '{"oneTime":{"date":"2031-10-01","startTime":"09:00","endTime":"10:00","volunteers":5}}'::jsonb,
  true
FROM (VALUES ('1'), ('3'), ('4'), ('5'), ('6'), ('7'), ('8'), ('9')) AS fixture(suffix);

SELECT extensions.ok(
  has_function_privilege('service_role', 'public.prepare_project_deletion(uuid,uuid,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.finalize_project_deletion(uuid,uuid,uuid)', 'EXECUTE'),
  'service_role may run both deletion steps'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'public.prepare_project_deletion(uuid,uuid,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.finalize_project_deletion(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.prepare_project_deletion(uuid,uuid,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.finalize_project_deletion(uuid,uuid,uuid)', 'EXECUTE'),
  'browser roles may run neither deletion step'
);
SELECT extensions.is(
  (SELECT count(*) FROM pg_proc AS p
   WHERE p.oid IN (
     'public.prepare_project_deletion(uuid,uuid,boolean)'::regprocedure,
     'public.finalize_project_deletion(uuid,uuid,uuid)'::regprocedure,
     'app_private.track_project_asset_references()'::regprocedure,
     'app_private.fence_project_asset_object_write()'::regprocedure,
     'app_private.register_project_asset_object()'::regprocedure,
     'app_private.guard_project_asset_object_delete()'::regprocedure,
     'app_private.fence_deleting_project_waiver_signature()'::regprocedure,
     'app_private.project_deletion_refusal(uuid,uuid)'::regprocedure,
     'app_private.project_deletion_candidates(uuid)'::regprocedure
   )
     AND p.prosecdef
     AND p.proconfig = ARRAY['search_path=""']),
  9::bigint,
  'every definer in the lifecycle pins an empty search_path'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app_private')
      AND p.proname IN (
        'prepare_project_deletion', 'finalize_project_deletion',
        'project_asset_name_project', 'project_asset_reference',
        'project_asset_references_of', 'track_project_asset_references',
        'fence_project_asset_object_write', 'register_project_asset_object',
        'guard_project_asset_object_delete',
        'fence_deleting_project_waiver_signature',
        'project_deletion_refusal', 'project_deletion_candidates'
      )
      AND (acl.grantee = 0 OR acl.grantee IN ('anon'::regrole, 'authenticated'::regrole))
  ),
  'no lifecycle function is executable by PUBLIC or a browser role'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'app_private.project_asset_objects', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'app_private.project_asset_references', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'app_private.project_deletion_operations', 'SELECT')
    AND NOT has_table_privilege('service_role', 'app_private.project_asset_objects', 'SELECT')
    AND NOT has_table_privilege('service_role', 'app_private.project_deletion_operations', 'SELECT'),
  'the registry, references, and operations are not readable through the API roles'
);

-- Ownership is recorded only for an upload the signed-in organizer made.
SET LOCAL request.jwt.claims =
  '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
SELECT upload.bucket_id, upload.name,
  'a8000000-0000-4000-8000-000000000001'::uuid, 'a8000000-0000-4000-8000-000000000001'
FROM (VALUES
  ('project-images', 'project_a8200000-0000-4000-8000-000000000001_cover_1.png'),
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf'),
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf'),
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000006_shared_1.pdf'),
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000008_org_1.pdf'),
  ('project-images', 'project_a8200000-0000-4000-8000-000000000009_cover_1.png')
) AS upload(bucket_id, name);
RESET ROLE;

SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_objects
   WHERE state = 'active'
     AND registered_by = 'a8000000-0000-4000-8000-000000000001'
     AND owner_project_id = app_private.project_asset_name_project(object_name)),
  6::bigint,
  'an organizer upload with a canonical name is registered to its project'
);

-- Written as the table owner: an upload with no Storage owner, one whose owner
-- is not an organizer, and one whose name is not canonical.
INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
VALUES
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000001_service_1.pdf',
   NULL, NULL),
  ('project-documents', 'project_a8200000-0000-4000-8000-000000000001_stranger_1.pdf',
   'a8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002'),
  ('project-documents', 'not-a-canonical-name.pdf',
   'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001');
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_objects),
  6::bigint,
  'uploads without proven ownership or a canonical name are not registered'
);

SET LOCAL request.jwt.claims =
  '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
    VALUES ('project-images', 'project_a8200000-0000-4000-8000-000000000001_intruder.png',
      'a8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002')$$,
  '42501', NULL,
  'a user who does not organize the project cannot upload under its name'
);
RESET ROLE;

-- Links are derived from the project row.
UPDATE public.projects
SET cover_image_url = 'https://synthetic-platform.example.test/storage/v1/object/public/project-images/project_a8200000-0000-4000-8000-000000000001_cover_1.png?v=2',
    documents = '[{"name":"guide.pdf","url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/project_a8200000-0000-4000-8000-000000000001_guide_1.pdf"}]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_references
   WHERE project_id = 'a8200000-0000-4000-8000-000000000001'),
  2::bigint,
  'a project row links its cover image and its documents'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, cover_image_url, documents
)
SELECT
  'a8200000-0000-4000-8000-000000000002', source.creator_id,
  'Asset lifecycle clone', 'Local', 'Synthetic', 'oneTime', 'manual',
  source.schedule, true, source.cover_image_url, source.documents
FROM public.projects AS source
WHERE source.id = 'a8200000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_references
   WHERE project_id = 'a8200000-0000-4000-8000-000000000002'),
  2::bigint,
  'a clone that copies the links is recorded as a second linker'
);

UPDATE public.projects
SET cover_image_url = 'https://unrelated.example.test/files/project_a8200000-0000-4000-8000-000000000001_cover_1.png',
    documents = '[{"name":"x","url":"/project-documents/project_a8200000-0000-4000-8000-000000000001_guide_1.pdf"},{"name":"y","url":"https://synthetic-platform.example.test/storage/v1/object/public/avatars/project_a8200000-0000-4000-8000-000000000001_guide_1.pdf"}]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000004';
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_references
   WHERE project_id = 'a8200000-0000-4000-8000-000000000004'),
  0::bigint,
  'a URL outside the exact public object path of a project bucket is not a link'
);

-- A link may carry one layer of percent-encoding on any canonical character.
-- It names the same object, so it protects it the same way.
SELECT extensions.is(
  app_private.project_asset_reference(
    'https://synthetic-platform.example.test/storage/v1/object/public/project-images/%70roject%5Fa8200000-0000-4000-8000-000000000001%5fcover_1%2Epng'
  ),
  ARRAY['project-images', 'project_a8200000-0000-4000-8000-000000000001_cover_1.png'],
  'a percent-encoded canonical name is read as the object it names'
);
SELECT extensions.is(
  app_private.project_asset_reference(
    'http://127.0.0.1:54321/storage/v1/object/public/project%2Ddocuments/project_a8200000-0000-4000-8000-000000000001_guide_1.pdf?download=a%2Fb#frag/ment'
  ),
  ARRAY['project-documents', 'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf'],
  'an encoded bucket is read the same way, and the query and fragment are ignored'
);
SELECT extensions.is(
  (SELECT count(*)
   FROM (VALUES
     -- incomplete or non-hexadecimal escapes
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover_1.png%7'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover_1%zzpng'),
     ('project-images/%'),
     -- encoded separators, traversal, NUL and non-ASCII bytes
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%2F1.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%5C1.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%3F1.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%231.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%001.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover%C3%A9.png'),
     ('project-images%2Fproject_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('project-images/..%2Fproject-images%2Fproject_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     -- encoded twice
     ('project-images/%2570roject_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('project-images/project%255Fa8200000-0000-4000-8000-000000000001_cover_1.png'),
     -- literal characters a canonical name cannot contain
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover 1.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover+1.png'),
     -- names and buckets that are not canonical once decoded
     ('project-images/%50roject_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('project-images/Project_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('Project-Images/project_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('avatars/project_a8200000-0000-4000-8000-000000000001_cover_1.png'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_'),
     ('project-images/project_a8200000-0000-4000-8000-000000000001_cover_1.png/extra')
   ) AS refused(path)
   WHERE app_private.project_asset_reference(
     'https://synthetic-platform.example.test/storage/v1/object/public/' || refused.path
   ) IS NOT NULL),
  0::bigint,
  'malformed, doubly encoded, traversing and non-canonical links are not recognized'
);
SELECT extensions.results_eq(
  $$SELECT linked.bucket_id, linked.object_name
    FROM app_private.project_asset_references_of(
      'https://synthetic-platform.example.test/storage/v1/object/public/project-images/%70roject%5Fa8200000-0000-4000-8000-000000000001_cover_1.png',
      '[{"url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/project%5Fa8200000-0000-4000-8000-000000000001_guide_1.pdf"},{"url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/project_a8200000-0000-4000-8000-000000000001_guide_1.pdf"},{"url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/%2570roject_a8200000-0000-4000-8000-000000000001_guide_1.pdf"}]'::jsonb
    ) AS linked
    ORDER BY 1, 2$$,
  $$VALUES
    ('project-documents', 'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf'),
    ('project-images', 'project_a8200000-0000-4000-8000-000000000001_cover_1.png')$$,
  'the link set a backfill or a trigger derives decodes each link once and merges duplicates'
);

UPDATE public.projects
SET documents = '[{"name":"encoded","url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/%70roject%5Fa8200000-0000-4000-8000-000000000001_guide_1.pdf"}]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000004';
SELECT extensions.is(
  (SELECT object_name FROM app_private.project_asset_references
   WHERE project_id = 'a8200000-0000-4000-8000-000000000004'),
  'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf',
  'a project row with a percent-encoded link is recorded as linking the real object'
);
-- Only the encoded link protects the file here: the clone's link is cleared.
UPDATE public.projects SET documents = '[]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok(
  $$DELETE FROM storage.objects
    WHERE bucket_id = 'project-documents'
      AND name = 'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf'$$,
  '23503', 'project_asset_referenced',
  'a file linked only through a percent-encoded URL cannot be removed directly'
);
-- Restore the fixture links the rest of this file depends on.
UPDATE public.projects AS clone
SET documents = source.documents
FROM public.projects AS source
WHERE clone.id = 'a8200000-0000-4000-8000-000000000002'
  AND source.id = 'a8200000-0000-4000-8000-000000000001';
UPDATE public.projects SET documents = '[]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000004';

-- Project 7 links project 6's file, here through another host with the same
-- canonical path. Project 9 links its own cover.
UPDATE public.projects
SET documents = '[{"name":"shared","url":"https://unrelated.example.test/storage/v1/object/public/project-documents/project_a8200000-0000-4000-8000-000000000006_shared_1.pdf"}]'::jsonb
WHERE id = 'a8200000-0000-4000-8000-000000000007';
UPDATE public.projects
SET cover_image_url = 'https://synthetic-platform.example.test/storage/v1/object/public/project-images/project_a8200000-0000-4000-8000-000000000009_cover_1.png'
WHERE id = 'a8200000-0000-4000-8000-000000000009';

-- A removal that bypasses the action still cannot take a shared file.
SELECT extensions.throws_ok(
  $$DELETE FROM storage.objects
    WHERE bucket_id = 'project-images'
      AND name = 'project_a8200000-0000-4000-8000-000000000001_cover_1.png'$$,
  '23503', 'project_asset_referenced',
  'a direct removal cannot take a file another project links'
);

-- Authorization and retention are decided in the database.
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002'
  )->>'outcome',
  'forbidden', 'an actor who may not delete the project is refused'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-0000000000ff', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'project_not_found', 'a missing project with no receipt is reported, not prepared'
);
SELECT extensions.throws_ok(
  $$SELECT public.prepare_project_deletion(NULL, 'a8000000-0000-4000-8000-000000000001')$$,
  '22023', 'Invalid project deletion scope.',
  'a missing project identifier is rejected'
);

INSERT INTO public.project_signups (id, project_id, schedule_id, status, user_id)
VALUES
  ('a8400000-0000-4000-8000-000000000005', 'a8200000-0000-4000-8000-000000000005',
   'asset-lifecycle-slot', 'approved', 'a8000000-0000-4000-8000-000000000001'),
  ('a8400000-0000-4000-8000-000000000003', 'a8200000-0000-4000-8000-000000000003',
   'asset-lifecycle-slot', 'approved', 'a8000000-0000-4000-8000-000000000001');
INSERT INTO public.waiver_definitions (
  id, scope, project_id, title, source, created_by, pdf_storage_path
)
VALUES
  ('a8300000-0000-4000-8000-000000000005', 'project',
   'a8200000-0000-4000-8000-000000000005', 'Asset lifecycle waiver', 'project_pdf',
   'a8000000-0000-4000-8000-000000000001',
   'project_waivers/a8200000-0000-4000-8000-000000000005/definition.pdf'),
  ('a8300000-0000-4000-8000-000000000003', 'project',
   'a8200000-0000-4000-8000-000000000003', 'Asset lifecycle waiver', 'project_pdf',
   'a8000000-0000-4000-8000-000000000001',
   'project_waivers/a8200000-0000-4000-8000-000000000003/definition.pdf');
INSERT INTO public.waiver_signatures (
  id, project_id, signup_id, user_id, signer_name, signer_email,
  signature_type, signature_text, waiver_definition_id, waiver_pdf_storage_path
)
VALUES (
  'a8500000-0000-4000-8000-000000000005', 'a8200000-0000-4000-8000-000000000005',
  'a8400000-0000-4000-8000-000000000005', 'a8000000-0000-4000-8000-000000000001',
  'Synthetic Signer', 'asset-lifecycle-creator@local.test', 'typed', 'Synthetic Signer',
  'a8300000-0000-4000-8000-000000000005',
  'project_waivers/a8200000-0000-4000-8000-000000000005/signature.pdf'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000005', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'signed_waivers', 'a project with a signed waiver is retained'
);
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_deletion_operations),
  0::bigint, 'a refused preparation leaves no operation behind'
);

-- Deleting the source keeps what its clone links.
CREATE TEMP TABLE source_deletion AS
SELECT public.prepare_project_deletion(
  'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001'
) AS receipt;
SELECT extensions.is(
  (SELECT receipt->>'outcome' FROM source_deletion), 'prepared',
  'the creator can prepare the source deletion'
);
SELECT extensions.is(
  (SELECT jsonb_array_length(receipt->'objects') FROM source_deletion), 0,
  'files the clone links, and unregistered files, are not claimed'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM source_deletion),
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002'
  )->>'outcome',
  'forbidden', 'finalize reauthorizes the actor'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM source_deletion),
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'completed', 'the source deletion completes'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.projects WHERE id = 'a8200000-0000-4000-8000-000000000001'),
  0::bigint, 'the source project row is gone'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE name IN (
     'project_a8200000-0000-4000-8000-000000000001_cover_1.png',
     'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf',
     'project_a8200000-0000-4000-8000-000000000001_service_1.pdf')),
  3::bigint, 'the shared files and the unregistered file are still stored'
);
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_objects
   WHERE owner_project_id = 'a8200000-0000-4000-8000-000000000001' AND state = 'active'),
  2::bigint, 'the registry keeps ownership after the owning project is gone'
);

-- A lost response is confirmed from the durable receipt, for its actor only.
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001'
  ) - 'replayed',
  jsonb_build_object(
    'outcome', 'completed',
    'operationId', (SELECT receipt->>'operationId' FROM source_deletion),
    'projectId', 'a8200000-0000-4000-8000-000000000001',
    'phase', 'completed'
  ),
  'the actor who completed a deletion reads its receipt back after the row is gone'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002'
  ),
  '{"outcome":"project_not_found"}'::jsonb,
  'another actor learns nothing about a completed deletion'
);

-- Replay-only mode is a read. It returns the same receipt to the same actor,
-- and for a project that still exists it begins nothing, even for an actor
-- who would be allowed to delete it.
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', true
  ) - 'replayed',
  jsonb_build_object(
    'outcome', 'completed',
    'operationId', (SELECT receipt->>'operationId' FROM source_deletion),
    'projectId', 'a8200000-0000-4000-8000-000000000001',
    'phase', 'completed'
  ),
  'replay-only returns the actor''s own completed receipt'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', true
  ),
  '{"outcome":"project_not_found"}'::jsonb,
  'replay-only tells another actor nothing'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', true
  ),
  '{"outcome":"project_not_found"}'::jsonb,
  'replay-only reports an existing project as not found, even to its creator'
);
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_deletion_operations
   WHERE project_id = 'a8200000-0000-4000-8000-000000000003')
  + (SELECT count(*) FROM app_private.project_asset_objects
     WHERE owner_project_id = 'a8200000-0000-4000-8000-000000000003' AND state <> 'active'),
  0::bigint,
  'replay-only creates no operation and claims no file'
);
SELECT extensions.throws_ok(
  $$SELECT public.prepare_project_deletion(
      'a8200000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', NULL)$$,
  '22023', 'Invalid project deletion scope.',
  'a missing replay mode is rejected rather than treated as a real preparation'
);

-- A deleted project identity is never created again.
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login
    ) VALUES (
      'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001',
      'Reused identity', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-10-01","startTime":"09:00","endTime":"10:00","volunteers":5}}'::jsonb,
      true
    )$$,
  '23514', 'project_identity_retired',
  'a project cannot be inserted under a deleted project identity'
);
SELECT extensions.lives_ok(
  $$INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login
    ) VALUES (
      'a8200000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001',
      'New identity', 'Local', 'Synthetic', 'oneTime', 'manual',
      '{"oneTime":{"date":"2031-10-01","startTime":"09:00","endTime":"10:00","volunteers":5}}'::jsonb,
      true
    )$$,
  'a project with a new identity and no files is still inserted'
);

-- An owner that disappeared outside the reviewed path left no receipt, so a
-- link to its file authorizes nothing.
DELETE FROM public.projects WHERE id = 'a8200000-0000-4000-8000-000000000006';
CREATE TEMP TABLE unreceipted_deletion AS
SELECT public.prepare_project_deletion(
  'a8200000-0000-4000-8000-000000000007', 'a8000000-0000-4000-8000-000000000001'
) AS receipt;
SELECT extensions.is(
  (SELECT jsonb_array_length(receipt->'objects') FROM unreceipted_deletion), 0,
  'a file whose owner has no completed deletion is not claimed by a linker'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM unreceipted_deletion),
    'a8200000-0000-4000-8000-000000000007', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'completed', 'the linking project is still deleted'
);
SELECT extensions.is(
  (SELECT count(*)
   FROM storage.objects AS stored
   JOIN app_private.project_asset_objects AS asset
     ON asset.bucket_id = stored.bucket_id AND asset.object_name = stored.name
   WHERE stored.name = 'project_a8200000-0000-4000-8000-000000000006_shared_1.pdf'
     AND asset.state = 'active'),
  1::bigint, 'the ambiguous file is kept and stays registered'
);

-- The last project linking files whose owner was deleted through the reviewed
-- path releases them.
CREATE TEMP TABLE clone_deletion AS
SELECT public.prepare_project_deletion(
  'a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'
) AS receipt;
SELECT extensions.is(
  (SELECT jsonb_array_length(receipt->'objects') FROM clone_deletion), 2,
  'the last linker claims the files of an owner with a completed deletion'
);
SELECT extensions.is(
  (SELECT bool_and((object->>'present')::boolean)
   FROM clone_deletion, jsonb_array_elements(receipt->'objects') AS object),
  true, 'each claimed file is reported as still stored'
);
SELECT extensions.is(
  (public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'
  ))->>'operationId',
  (SELECT receipt->>'operationId' FROM clone_deletion),
  'preparing again resumes the same operation'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM clone_deletion),
    'a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'objects_remaining', 'finalize refuses while a claimed file is still stored'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.projects WHERE id = 'a8200000-0000-4000-8000-000000000002'),
  1::bigint, 'the project is kept until its files are verifiably gone'
);
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET cover_image_url = 'https://synthetic-platform.example.test/storage/v1/object/public/project-images/project_a8200000-0000-4000-8000-000000000001_cover_1.png'
    WHERE id = 'a8200000-0000-4000-8000-000000000004'$$,
  '23514', 'project_asset_unavailable',
  'another project cannot link a claimed file'
);
SELECT extensions.lives_ok(
  $$DELETE FROM storage.objects
    WHERE name IN (
      'project_a8200000-0000-4000-8000-000000000001_cover_1.png',
      'project_a8200000-0000-4000-8000-000000000001_guide_1.pdf')$$,
  'the claimed files can be removed while the actor is still authorized'
);
SELECT extensions.is(
  (SELECT count(*) FROM app_private.project_asset_objects
   WHERE owner_project_id = 'a8200000-0000-4000-8000-000000000001'
     AND state = 'deleted' AND claim_operation_id IS NOT NULL),
  2::bigint, 'a removed claimed file leaves a permanent tombstone'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM clone_deletion),
    'a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'completed', 'finalize completes once the files are gone'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM clone_deletion),
    'a8200000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001'
  )->>'replayed',
  'true', 'a repeated finalize returns the same completed receipt'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM clone_deletion),
    'a8200000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'operation_mismatch', 'an operation cannot be finalized for another project'
);
SELECT extensions.throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('project-images', 'project_a8200000-0000-4000-8000-000000000001_cover_1.png')$$,
  '23514', 'project_asset_object_retired',
  'a file name a deletion removed is never reused'
);
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET cover_image_url = 'https://synthetic-platform.example.test/storage/v1/object/public/project-images/project_a8200000-0000-4000-8000-000000000001_cover_1.png'
    WHERE id = 'a8200000-0000-4000-8000-000000000004'$$,
  '23514', 'project_asset_unavailable',
  'a removed file cannot be linked again'
);

-- The removal itself rechecks the actor carrying the deletion.
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000008', 'a8000000-0000-4000-8000-000000000003'
  )->>'outcome',
  'prepared', 'an active organization administrator can prepare a deletion'
);
SET LOCAL session_replication_role = replica;
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'a8100000-0000-4000-8000-000000000001'
  AND user_id = 'a8000000-0000-4000-8000-000000000003';
SET LOCAL session_replication_role = origin;
SELECT extensions.throws_ok(
  $$DELETE FROM storage.objects
    WHERE name = 'project_a8200000-0000-4000-8000-000000000008_org_1.pdf'$$,
  '42501', 'project_deletion_not_authorized',
  'a claimed file is not removed once its actor is no longer an active administrator'
);
SELECT extensions.is(
  (SELECT count(*) FROM storage.objects
   WHERE name = 'project_a8200000-0000-4000-8000-000000000008_org_1.pdf'),
  1::bigint, 'the file is still stored after the refused removal'
);
SELECT extensions.is(
  public.prepare_project_deletion(
    'a8200000-0000-4000-8000-000000000008', 'a8000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'resumed', 'another currently authorized actor can carry the open deletion forward'
);
SELECT extensions.lives_ok(
  $$DELETE FROM storage.objects
    WHERE name = 'project_a8200000-0000-4000-8000-000000000008_org_1.pdf'$$,
  'the claimed file is removed for the newly authorized actor'
);

-- An ordinary removal of an unshared file is allowed, and records that the
-- file is gone so a copy made from stale data cannot link it.
SELECT extensions.lives_ok(
  $$DELETE FROM storage.objects
    WHERE name = 'project_a8200000-0000-4000-8000-000000000009_cover_1.png'$$,
  'an organizer can still remove a file only its own project links'
);
SELECT extensions.is(
  (SELECT state || ':' || coalesce(claim_operation_id::text, 'unclaimed')
   FROM app_private.project_asset_objects
   WHERE object_name = 'project_a8200000-0000-4000-8000-000000000009_cover_1.png'),
  'deleted:unclaimed', 'the ordinary removal is recorded without a claim'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, cover_image_url
    )
    SELECT 'a8200000-0000-4000-8000-00000000000b', source.creator_id,
      'Stale clone', 'Local', 'Synthetic', 'oneTime', 'manual', source.schedule, true,
      source.cover_image_url
    FROM public.projects AS source
    WHERE source.id = 'a8200000-0000-4000-8000-000000000009'$$,
  '23514', 'project_asset_unavailable',
  'a clone made from stale data cannot link a file that was removed'
);
SELECT extensions.lives_ok(
  $$UPDATE public.projects SET cover_image_url = NULL
    WHERE id = 'a8200000-0000-4000-8000-000000000009'$$,
  'the owning project can still clear its link to the removed file'
);
SET LOCAL request.jwt.claims =
  '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.lives_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
    VALUES ('project-images', 'project_a8200000-0000-4000-8000-000000000009_cover_1.png',
      'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001')$$,
  'a name an ordinary removal freed can be uploaded again'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT state FROM app_private.project_asset_objects
   WHERE object_name = 'project_a8200000-0000-4000-8000-000000000009_cover_1.png'),
  'active', 'the new upload makes the record active again'
);

-- A project being deleted is frozen: its unlinked upload is claimed, and no
-- upload, link, or signed waiver can arrive behind the claim.
CREATE TEMP TABLE zero_link_deletion AS
SELECT public.prepare_project_deletion(
  'a8200000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001'
) AS receipt;
SELECT extensions.is(
  (SELECT receipt->'objects'->0->>'name' FROM zero_link_deletion),
  'project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf',
  'an upload recorded for the project is claimed even though nothing links it'
);

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
    VALUES ('project-documents', 'project_a8200000-0000-4000-8000-000000000003_late_1.pdf',
      'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001')$$,
  '23514', 'project_deletion_in_progress',
  'a project being deleted accepts no late upload'
);
RESET ROLE;
SELECT extensions.throws_ok(
  $$UPDATE public.projects
    SET documents = '[{"name":"late","url":"https://synthetic-platform.example.test/storage/v1/object/public/project-documents/project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf"}]'::jsonb
    WHERE id = 'a8200000-0000-4000-8000-000000000003'$$,
  '23514', 'project_deletion_in_progress',
  'a project being deleted cannot change its links'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.waiver_signatures (
      id, project_id, signup_id, user_id, signer_name, signer_email,
      signature_type, signature_text, waiver_definition_id, waiver_pdf_storage_path
    ) VALUES (
      'a8500000-0000-4000-8000-000000000003', 'a8200000-0000-4000-8000-000000000003',
      'a8400000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001',
      'Synthetic Signer', 'asset-lifecycle-creator@local.test', 'typed', 'Synthetic Signer',
      'a8300000-0000-4000-8000-000000000003',
      'project_waivers/a8200000-0000-4000-8000-000000000003/signature.pdf'
    )$$,
  '23514', 'project_deletion_in_progress',
  'a project being deleted accepts no new signed waiver'
);

-- A different object under the claimed name is not the claimed object.
SET LOCAL session_replication_role = replica;
DELETE FROM storage.objects
WHERE name = 'project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf';
INSERT INTO storage.objects (bucket_id, name)
VALUES ('project-documents', 'project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf');
SET LOCAL session_replication_role = origin;

SELECT extensions.throws_ok(
  $$DELETE FROM storage.objects
    WHERE name = 'project_a8200000-0000-4000-8000-000000000003_orphan_1.pdf'$$,
  '23514', 'project_asset_object_replaced',
  'a replacement under a claimed name cannot be removed through the claim'
);
SELECT extensions.is(
  public.finalize_project_deletion(
    (SELECT (receipt->>'operationId')::uuid FROM zero_link_deletion),
    'a8200000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001'
  )->'objects'->0->>'replaced',
  'true', 'finalize reports the replacement and does not complete'
);
SELECT extensions.is(
  (SELECT count(*) FROM public.projects WHERE id = 'a8200000-0000-4000-8000-000000000003'),
  1::bigint, 'the project with a replaced file is kept'
);

SELECT * FROM extensions.finish();

ROLLBACK;
