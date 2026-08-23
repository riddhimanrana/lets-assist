BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  '99c3df1a7e9f39523c7a615017461c14ed88c7fc',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  '745f4422d3e59bb38ff26f1219bb91881864f7226e83f78677bc90ad46d19861',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  '8f1bbfcb8000e468f5339e6e004ee17def0cede0',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  'sha256:5b7facdf91a1338bf19373007e413e1cea168f606bec8300480ae985b660c845',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2'),
  '{"minimum":"2.0.0","maximum":"2.0.2"}'::jsonb,
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dv-speech-debate'),
  '2.0.2',
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dv-speech-debate'),
  '99c3df1a7e9f39523c7a615017461c14ed88c7fc',
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
