BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  'bb7029dda2fafaa107eaad1f55003fce2ac19cab',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  '1de7e9bedc1208feffe56a999d4866d7a507a748e9a0752ecb37f24888fd5068',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  'c06d2a5626063873d8cbffe33514f134bfcb8e79',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  'sha256:2a44c7bc291c4c7cb2b9130dd1893c6d3e019c09018d5185c3833b3e4dba4439',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.34'),
  '{"minimum":"1.1.0","maximum":"1.2.34"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.2.37',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  '18427766939ab0248d4597eaf00f17f51fe1242e',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
