-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.34';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'bb7029dda2fafaa107eaad1f55003fce2ac19cab'
      OR v_existing.manifest_hash IS DISTINCT FROM '1de7e9bedc1208feffe56a999d4866d7a507a748e9a0752ecb37f24888fd5068'
      OR v_existing.source_tree IS DISTINCT FROM 'c06d2a5626063873d8cbffe33514f134bfcb8e79'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:2a44c7bc291c4c7cb2b9130dd1893c6d3e019c09018d5185c3833b3e4dba4439'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:161cf81255e5e9f3b3a9de38ee185fb905fa70c304c039dfb1951b338277694f'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.34","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.34/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260911203901'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.34"}'::jsonb
      OR v_existing.runtime_profile IS DISTINCT FROM 'embedded'
      OR v_existing.rollout_percentage IS DISTINCT FROM 0
    THEN
      RAISE EXCEPTION 'Existing plugin release conflicts with the signed release identity';
    END IF;
  ELSE
    INSERT INTO public.plugin_versions (
      plugin_key, version, status, changelog, commit_sha, manifest_hash,
      compatibility_contract, rollout_percentage, source_tree, content_digest,
      release_inputs, build_digest, sbom_digest, signer_identity, host_api_range,
      plugin_data_schema_version, required_platform_schema_version,
      supported_install_contracts, runtime_profile, published_at
    ) VALUES (
      'dvhs-csf',
      '1.2.34',
      'published',
      '## 1.2.34

- Add the general post composer to officer Home for administrators and officers who can manage posts. Keep the class Stream composer locked to its class.
- Copy private test workbooks into My Drive without requiring root-folder read access, then verify ownership and privacy before saving success.
- Keep the officer Home pending-submission count while skipping the unused submission-record query.
',
      'bb7029dda2fafaa107eaad1f55003fce2ac19cab',
      '1de7e9bedc1208feffe56a999d4866d7a507a748e9a0752ecb37f24888fd5068',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c06d2a5626063873d8cbffe33514f134bfcb8e79',
      'sha256:2a44c7bc291c4c7cb2b9130dd1893c6d3e019c09018d5185c3833b3e4dba4439',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:161cf81255e5e9f3b3a9de38ee185fb905fa70c304c039dfb1951b338277694f',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.34","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.34/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260911203901',
      '{"minimum":"1.1.0","maximum":"1.2.34"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.34',
      code_reference = 'bb7029dda2fafaa107eaad1f55003fce2ac19cab',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.1.0'
    AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.34'
      AND code_reference = 'bb7029dda2fafaa107eaad1f55003fce2ac19cab'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
