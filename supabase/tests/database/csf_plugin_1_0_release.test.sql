BEGIN;

SELECT plan(8);

SELECT is(
  (SELECT version FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  '1.0.0',
  'DVHS CSF 1.0.0 is registered'
);
SELECT is(
  (SELECT status FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  'published',
  'DVHS CSF 1.0.0 is published'
);
SELECT is(
  (SELECT commit_sha FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  'c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa',
  'release records the exact private source commit'
);
SELECT is(
  (SELECT manifest_hash FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  '7334038cb6519e1732d9ac9ba0111f0ae41cfef2861c36595be975ba60f95534',
  'release records the exact manifest hash'
);
SELECT is(
  (SELECT rollout_percentage FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  0,
  'automatic rollout stays disabled'
);
SELECT is(
  (SELECT compatibility_contract ->> 'automaticUpdate'
   FROM public.plugin_versions
   WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0'),
  'false',
  'compatibility contract remains pinned and manual'
);
SELECT is(
  (SELECT latest_version FROM public.plugins WHERE key = 'dvhs-csf'),
  '1.1.0',
  'catalog advertises the latest published 1.1.0 release'
);
SELECT is(
  (SELECT code_reference FROM public.plugins WHERE key = 'dvhs-csf'),
  '4d1001e9d3269b8bd28de93c071c6b4b216824fd',
  'catalog points to the exact latest private source commit'
);

SELECT * FROM finish();
ROLLBACK;
