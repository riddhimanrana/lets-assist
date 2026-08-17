BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.has_column(
  'public',
  'plugin_versions',
  'manifest_hash',
  'plugin releases record the reviewed manifest hash'
);
SELECT extensions.has_column(
  'public',
  'plugin_versions',
  'compatibility_contract',
  'plugin releases record machine-readable compatibility'
);
SELECT extensions.has_column(
  'public',
  'plugin_versions',
  'rollout_percentage',
  'plugin releases carry an explicit staged rollout percentage'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.plugins AS plugin
    LEFT JOIN public.plugin_versions AS release
      ON release.plugin_key = plugin.key
      AND release.version = plugin.latest_version
      AND release.status = 'published'
    WHERE plugin.is_active = true
      AND release.id IS NULL
  ),
  0::bigint,
  'every active catalog version resolves to a published release'
);

INSERT INTO public.plugins (
  key, name, visibility, is_active, latest_version, private_codebase
) VALUES (
  'synthetic-release-contract',
  'Synthetic release contract',
  'private',
  false,
  '1.0.0',
  true
);

SELECT extensions.throws_ok(
  $$UPDATE public.plugins SET is_active = true WHERE key = 'synthetic-release-contract'$$,
  NULL,
  'active plugin latest_version must reference a complete published release',
  'an unpublished catalog version cannot be activated'
);

INSERT INTO public.plugin_versions (
  plugin_key,
  version,
  status,
  changelog,
  commit_sha,
  manifest_hash,
  compatibility_contract,
  rollout_percentage,
  published_at
) VALUES (
  'synthetic-release-contract',
  '1.0.0',
  'published',
  'Synthetic publication',
  repeat('1', 40),
  repeat('2', 64),
  '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
  0,
  now()
);

SELECT extensions.lives_ok(
  $$UPDATE public.plugins SET is_active = true WHERE key = 'synthetic-release-contract'$$,
  'a complete published release can activate the catalog entry'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'a6100000-0000-4000-8000-000000000001',
  'Synthetic Plugin Release Org',
  'synthetic_plugin_release_org',
  'nonprofit',
  '618402'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.organization_plugin_installs (organization_id, plugin_key, installed_version, auto_update) VALUES ('a6100000-0000-4000-8000-000000000001', 'synthetic-release-contract', '1.0.0', true)$$,
  NULL,
  'auto_update requires an explicitly compatible staged release',
  'auto-update fails closed without a compatible staged rollout'
);
SELECT extensions.lives_ok(
  $$INSERT INTO public.organization_plugin_installs (organization_id, plugin_key, installed_version, auto_update) VALUES ('a6100000-0000-4000-8000-000000000001', 'synthetic-release-contract', '1.0.0', false)$$,
  'an exact published release can remain pinned'
);

SELECT extensions.throws_ok(
  $$UPDATE public.plugin_versions SET manifest_hash = repeat('3', 64) WHERE plugin_key = 'synthetic-release-contract' AND version = '1.0.0'$$,
  NULL,
  'published plugin release metadata is immutable',
  'published manifest evidence cannot be rewritten'
);

SELECT extensions.throws_ok(
  $$UPDATE public.plugin_versions SET status = 'revoked' WHERE plugin_key = 'synthetic-release-contract' AND version = '1.0.0'$$,
  NULL,
  'advance or deactivate the plugin catalog before retiring its latest release',
  'the active latest release cannot be revoked in place'
);

SELECT extensions.lives_ok(
  $$UPDATE public.plugins SET is_active = false WHERE key = 'synthetic-release-contract'$$,
  'the catalog can be deactivated before release retirement'
);
SELECT extensions.lives_ok(
  $$UPDATE public.plugin_versions SET status = 'revoked' WHERE plugin_key = 'synthetic-release-contract' AND version = '1.0.0'$$,
  'a release can be revoked after its active catalog reference is removed'
);
SELECT extensions.throws_ok(
  $$UPDATE public.plugin_versions SET status = 'published' WHERE plugin_key = 'synthetic-release-contract' AND version = '1.0.0'$$,
  NULL,
  'a revoked plugin release cannot be restored',
  'a revoked release is terminal'
);

SELECT * FROM extensions.finish();
ROLLBACK;
