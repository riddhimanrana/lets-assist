BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  '1ba16c899076961dcb165025cff29b7a3900cc8b',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  'cc8575e90deecbdc171f8918da44b266cbd2c4dab64075d1970add1289e96c91',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  'e2c9e20ef6652244d916eb25601f4ec0f392f817',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  'sha256:eb8c963b49efbbc863bc594e50f0a4975897c3290afafde48877bd6d77a13c57',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.20'),
  '{"minimum":"1.1.0","maximum":"1.2.20"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.1.0',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  '4d1001e9d3269b8bd28de93c071c6b4b216824fd',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
