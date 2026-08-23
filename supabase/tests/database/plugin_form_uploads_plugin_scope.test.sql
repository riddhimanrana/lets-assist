-- Tenancy of the plugin form upload bucket.
--
-- The bucket's path grammar is {organization_id}/{plugin_key}/{user_id}/{file}.
-- Before the accompanying migration, only segment 3 was checked, so any
-- authenticated user could write under any organization and any plugin key as
-- long as the last segment was their own id. These assertions pin each segment.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ee000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'plugin-upload-scope@local.test', now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ee100000-0000-4000-8000-000000000001', 'Upload Scope Org', 'upload-scope-org', 'school', '885301'),
  ('ee100000-0000-4000-8000-000000000002', 'Foreign Org', 'upload-scope-foreign', 'school', '885302');

INSERT INTO public.plugins (key, name, visibility, is_active, latest_version)
VALUES
  ('upload-scope-installed', 'Upload Scope Installed', 'global', false, '1.0.0'),
  ('upload-scope-absent', 'Upload Scope Absent', 'global', false, '1.0.0');

-- An enabled install must reference a published release on an active catalog
-- entry, and the catalog itself refuses activation before that release exists.
-- The fixture therefore publishes first and activates second.
INSERT INTO public.plugin_versions (
  plugin_key, version, status, commit_sha, manifest_hash,
  compatibility_contract, published_at, source_tree, content_digest,
  release_inputs, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'upload-scope-installed',
  '1.0.0',
  'published',
  '3333333333333333333333333333333333333333',
  '3333333333333333333333333333333333333333333333333333333333333333',
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
  now(), repeat('4', 40), repeat('5', 64),
  '["plugins/upload-scope-installed"]'::jsonb,
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  1, '20260820100000',
  '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
  'embedded'
);

UPDATE public.plugins
SET is_active = true
WHERE key = 'upload-scope-installed';

INSERT INTO public.organization_plugin_installs (
  organization_id, plugin_key, enabled, installed_version
) VALUES (
  'ee100000-0000-4000-8000-000000000001', 'upload-scope-installed', true, '1.0.0'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ee000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- The sanctioned path. Note this user holds no membership row in the
-- organization: DV Speech and Debate uploads a membership application's files
-- during the join flow, before any membership exists, so this case failing
-- would break signup. It is the reason the predicate checks the install rather
-- than the uploader's membership.
SELECT extensions.lives_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ee400000-0000-4000-8000-000000000001',
      'plugin_form_uploads',
      'ee100000-0000-4000-8000-000000000001/upload-scope-installed/ee000000-0000-4000-8000-000000000001/application.pdf',
      'ee000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/pdf"}'::jsonb
    )
  $$,
  'a non-member may upload under an installed plugin, preserving the join flow'
);

-- Segment 2: a plugin the organization does not run.
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ee400000-0000-4000-8000-000000000002',
      'plugin_form_uploads',
      'ee100000-0000-4000-8000-000000000001/upload-scope-absent/ee000000-0000-4000-8000-000000000001/application.pdf',
      'ee000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/pdf"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an uninstalled plugin key is refused'
);

-- Segment 1: an organization the uploader has nothing to do with, and which
-- does not run the plugin either.
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ee400000-0000-4000-8000-000000000003',
      'plugin_form_uploads',
      'ee100000-0000-4000-8000-000000000002/upload-scope-installed/ee000000-0000-4000-8000-000000000001/application.pdf',
      'ee000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/pdf"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a foreign organization prefix is refused'
);

-- Segment 3 remains enforced.
SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ee400000-0000-4000-8000-000000000004',
      'plugin_form_uploads',
      'ee100000-0000-4000-8000-000000000001/upload-scope-installed/ee000000-0000-4000-8000-00000000ffff/application.pdf',
      'ee000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/pdf"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'another user''s prefix is refused'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'plugin_form_uploads'
      AND name LIKE 'ee100000-0000-4000-8000-000000000001/upload-scope-installed/%'
  ),
  1::bigint,
  'the uploader reads back only their accepted object'
);

-- Moves are server-side only. The absence of an UPDATE policy is the mechanism,
-- so it is asserted rather than assumed.
SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd = 'UPDATE'
      AND policyname ILIKE '%plugin form%'
  ),
  0::bigint,
  'no UPDATE policy exists for plugin form uploads'
);

RESET ROLE;

-- Disabling the install must close the namespace, not merely hide it from the
-- catalog: an organization that turns a plugin off stops being a valid target.
UPDATE public.organization_plugin_installs
SET enabled = false
WHERE organization_id = 'ee100000-0000-4000-8000-000000000001'
  AND plugin_key = 'upload-scope-installed';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ee000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$
    INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
    VALUES (
      'ee400000-0000-4000-8000-000000000005',
      'plugin_form_uploads',
      'ee100000-0000-4000-8000-000000000001/upload-scope-installed/ee000000-0000-4000-8000-000000000001/second.pdf',
      'ee000000-0000-4000-8000-000000000001',
      '{"mimetype":"application/pdf"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a disabled install closes the namespace to new uploads'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM storage.objects
    WHERE bucket_id = 'plugin_form_uploads'
      AND name LIKE 'ee100000-0000-4000-8000-000000000001/upload-scope-installed/%'
  ),
  0::bigint,
  'a disabled install also hides existing objects from the uploader'
);

-- The generic private plugin bucket stays server-role only: no client policy
-- may exist for it at all.
RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (qual LIKE '%''plugins''%' OR with_check LIKE '%''plugins''%')
      AND ('anon' = ANY (roles) OR 'authenticated' = ANY (roles))
  ),
  0::bigint,
  'the private plugins bucket exposes no browser-role policy'
);

SELECT * FROM extensions.finish();

ROLLBACK;
