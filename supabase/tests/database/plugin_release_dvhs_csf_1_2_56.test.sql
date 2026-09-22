BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  '593bddcab92ce700b108ff02cd802293baf02c72',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  '857f0b7623560e1890c56ae9229b19862113ce3d31c99bd691e9d68d7b6cd780',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  '736fb02aceaba0ffa8d4bfde3b22105ea443d7dc',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  'sha256:c39556ddcbbb94e6d20159dde7e78fc3b675a5521337c0215658c4b35b0cb193',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.56'),
  '{"minimum":"1.1.0","maximum":"1.2.56"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.2.71',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  'fd07c59049cfbd17d7e8d0a1c104898e7e762c14',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
