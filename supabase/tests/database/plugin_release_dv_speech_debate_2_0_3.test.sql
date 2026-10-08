BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  'd100831bd2fe3374715de20510d9ae2a77dcfba8',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  'c01b1846be90ed60dfc8a862063a0e10d19507b403738998acc8369be151b203',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  'c04f8a0dc45e4820aee4847afb32defdd7646fc3',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  'sha256:4494a5ffe6131dcc474ec9d64db5832754dbca5b2fdb61ded711a5c8f93c1395',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.3'),
  '{"minimum":"2.0.0","maximum":"2.0.3"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dv-speech-debate'),
  '2.0.3',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dv-speech-debate'),
  'd100831bd2fe3374715de20510d9ae2a77dcfba8',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
