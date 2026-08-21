BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  '37d0dbd414a64bf53076fe30450b38b1e90a4ec9',
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  '3b510417bf5e8d8512cbe9f74a5cd3cd0faf894b9a1c8325001c2dbb7d2de3cb',
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  'afa6799615e1d0af2b14072fee26122c07ca37d6',
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  'sha256:689a9c24c4d931c331a100911db2ce7fb20061102d2e3dd192c2185f40c91e0e',
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.2.1'),
  '{"minimum":"1.1.0","maximum":"1.2.1"}'::jsonb,
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

SELECT extensions.lives_ok(
  $$SELECT private.assert_dvhs_csf_1_2_1_release_identity()$$,
  'the reconciliation guard accepts the exact signed release identity'
);

ALTER TABLE public.plugin_versions
  DISABLE TRIGGER plugin_versions_enforce_immutable_release;
UPDATE public.plugin_versions
SET compatibility_contract = '{"host":"other-platform","automaticUpdate":false}'::jsonb
WHERE plugin_key = 'dvhs-csf'
  AND version = '1.2.1';
ALTER TABLE public.plugin_versions
  ENABLE TRIGGER plugin_versions_enforce_immutable_release;

SELECT extensions.throws_ok(
  $$SELECT private.assert_dvhs_csf_1_2_1_release_identity()$$,
  NULL,
  'Signed DVHS CSF 1.2.1 release identity is missing or divergent',
  'the reconciliation guard rejects a divergent signed identity field'
);

ALTER TABLE public.plugin_versions
  DISABLE TRIGGER plugin_versions_enforce_immutable_release;
UPDATE public.plugin_versions
SET compatibility_contract = '{"host":"lets-assist","automaticUpdate":false}'::jsonb
WHERE plugin_key = 'dvhs-csf'
  AND version = '1.2.1';
ALTER TABLE public.plugin_versions
  ENABLE TRIGGER plugin_versions_enforce_immutable_release;

SELECT extensions.lives_ok(
  $$SELECT private.assert_dvhs_csf_1_2_1_release_identity()$$,
  'the reconciliation guard accepts the restored signed release identity'
);

SELECT * FROM extensions.finish();
ROLLBACK;
