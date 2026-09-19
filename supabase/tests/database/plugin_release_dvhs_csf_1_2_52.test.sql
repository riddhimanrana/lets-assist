BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  '7735472c1e0fc663bc855fb158e2d8e9c026d2a7',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  'e733b7910fb76665c9b9116c81d72924ba81497f97719b74ccd516b85329148f',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  '851123be343ac92a7182f2c3c9be57a4aa21da88',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  'sha256:11a098a91081c4ef5e60a1e3502eb0558e9ccca6b12fae282e4cd9cbf93b7e6a',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.52'),
  '{"minimum":"1.1.0","maximum":"1.2.52"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.2.52',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  '7735472c1e0fc663bc855fb158e2d8e9c026d2a7',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
