BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  '1726e639955c3259ce7565879fd3195a369fb3c3',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  'fe0db69b5f2c27acc885641ecdf5021bf22cb7ec48d2ae29560cf64543f72f67',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  '0b2fd1ca90f20ef05cf77c4db909e1a6c9f96226',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  'sha256:35d2d1760cf21e8f0f553c2ef5ae45dfeae92ebaddd7dc4073ac02a4218faaec',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.50'),
  '{"minimum":"1.1.0","maximum":"1.2.50"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.2.77',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  '400af29c570bf3f1df6f6b5d05aee56e38ff1d07',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
