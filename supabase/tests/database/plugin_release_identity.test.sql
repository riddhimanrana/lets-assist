BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.has_column(
  'public', 'plugin_versions', 'content_digest',
  'plugin releases record a content digest'
);
SELECT extensions.has_column(
  'public', 'plugin_versions', 'release_inputs',
  'plugin releases record their digested inputs'
);
SELECT extensions.has_column(
  'public', 'plugin_versions', 'runtime_profile',
  'plugin releases record their runtime profile'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated', 'private.require_plugin_release_identity()', 'EXECUTE'
  ),
  'the provenance trigger function is not client callable'
);

INSERT INTO public.plugins (key, name, visibility, is_active, latest_version)
VALUES ('release-identity-test', 'Release identity test', 'global', false, '1.0.0');

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.plugin_versions (
      plugin_key, version, status, commit_sha, manifest_hash,
      compatibility_contract, published_at
    ) VALUES (
      'release-identity-test', '1.0.0', 'published', repeat('1', 40),
      repeat('1', 64), '{}'::jsonb, now()
    )
  $$,
  'P0001',
  'new published plugin releases require complete release identity',
  'a new published release cannot omit its release identity'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO public.plugin_versions (
      plugin_key, version, status, commit_sha, manifest_hash,
      compatibility_contract, published_at, source_tree, content_digest,
      release_inputs, host_api_range, plugin_data_schema_version,
      required_platform_schema_version, supported_install_contracts,
      runtime_profile
    ) VALUES (
      'release-identity-test', '1.0.0', 'published', repeat('1', 40),
      repeat('1', 64), '{}'::jsonb, now(), repeat('2', 40), repeat('2', 64),
      '["plugins/release-identity-test"]'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1, '20260820100000',
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      'embedded'
    )
  $$,
  'an embedded release can publish with complete source identity'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.plugin_versions
    SET content_digest = repeat('3', 64)
    WHERE plugin_key = 'release-identity-test' AND version = '1.0.0'
  $$,
  'P0001',
  'published plugin release metadata is immutable',
  'content identity is immutable after publication'
);

INSERT INTO public.plugin_versions (
  plugin_key, version, status, commit_sha, manifest_hash,
  compatibility_contract, published_at, source_tree, content_digest,
  release_inputs, host_api_range, plugin_data_schema_version,
  required_platform_schema_version, supported_install_contracts,
  runtime_profile
) VALUES (
  'release-identity-test', '2.0.0', 'review', repeat('4', 40), repeat('4', 64),
  '{}'::jsonb, now(), repeat('5', 40), repeat('5', 64),
  '["plugins/release-identity-test","apps/test","bun.lock"]'::jsonb,
  '{"minimum":"1.0.0"}'::jsonb, 2, '20260820100000',
  '{"minimum":"1.0.0","maximum":"2.0.0"}'::jsonb, 'application'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.plugin_versions
    SET status = 'published'
    WHERE plugin_key = 'release-identity-test' AND version = '2.0.0'
  $$,
  'P0001',
  'independently deployed plugin releases require build and SBOM digests',
  'an application release cannot publish without artifact identity'
);

UPDATE public.plugin_versions
SET build_digest = repeat('6', 64), sbom_digest = repeat('7', 64)
WHERE plugin_key = 'release-identity-test' AND version = '2.0.0';

SELECT extensions.lives_ok(
  $$
    UPDATE public.plugin_versions
    SET status = 'published'
    WHERE plugin_key = 'release-identity-test' AND version = '2.0.0'
  $$,
  'an application release publishes after build and SBOM identity exists'
);

SELECT extensions.is(
  (
    SELECT supported_install_contracts
    FROM public.plugin_versions
    WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'
  ),
  '{"minimum":"1.1.0","maximum":"1.1.0"}'::jsonb,
  'legacy releases are pinned to their existing install contract'
);

SELECT extensions.is(
  (
    SELECT runtime_profile
    FROM public.plugin_versions
    WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'
  ),
  'embedded',
  'legacy releases preserve their embedded runtime profile'
);

SELECT extensions.is(
  (
    SELECT content_digest
    FROM public.plugin_versions
    WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'
  ),
  NULL::text,
  'legacy release provenance stays honestly unknown'
);

SELECT extensions.ok(
  (
    SELECT bool_and(runtime_profile IS NOT NULL)
    FROM public.plugin_versions
  ),
  'every existing release has a runtime profile after the backfill'
);

SELECT extensions.finish();
ROLLBACK;
