BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);

SELECT extensions.is(
  (SELECT is_active FROM public.plugins WHERE key = 'dv-speech-debate'),
  false,
  'Speech and Debate is unavailable through active-catalog checks'
);
SELECT extensions.is(
  (SELECT visibility::text FROM public.plugins WHERE key = 'dv-speech-debate'),
  'private',
  'the paused offering remains private'
);
SELECT extensions.ok(
  (SELECT force_update_version IS NULL FROM public.plugins WHERE key = 'dv-speech-debate'),
  'the paused offering does not force an organization update'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM public.plugin_versions WHERE plugin_key = 'dv-speech-debate' AND version = '2.0.2' AND status = 'published'),
  'the prior signed release remains available as history'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM public.plugins WHERE key = 'dvhs-csf' AND is_active),
  'pausing Speech and Debate preserves the CSF offering'
);

SELECT * FROM extensions.finish();
ROLLBACK;
