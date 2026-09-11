-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.29';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '98c08ab2b3f63e313b915df5c7110413c013431a'
      OR v_existing.manifest_hash IS DISTINCT FROM '271d71b0a23c59b44cfbf435f9fa51f74b91b788a81e45abeea2dec7ccd3f291'
      OR v_existing.source_tree IS DISTINCT FROM 'c8b71c88c383907c8299c6bc3276a7c27b1a2c9c'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:0e4f3bcb451e592db38325d1aaa13a454b8717b34b5a505c19bf6e38c330f545'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:f670dadff613322aa911ff5b6c96d3a538271a41a7dab6e7e548bf655df3c22a'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:f5b2e1d8265d3c77f7a75f52bb9a9eed76e3c1c1342983fe3df0edcb42245c62'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.29","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.29/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260911195446'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.29"}'::jsonb
      OR v_existing.runtime_profile IS DISTINCT FROM 'application'
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
      '1.2.29',
      'published',
      '## 1.2.29

Recover a Comments export only after its complete Sheet row matches the saved attempt. Keep conflicting output on hold. Application, profile, and point discussions now use the permissions for their own records.
',
      '98c08ab2b3f63e313b915df5c7110413c013431a',
      '271d71b0a23c59b44cfbf435f9fa51f74b91b788a81e45abeea2dec7ccd3f291',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c8b71c88c383907c8299c6bc3276a7c27b1a2c9c',
      'sha256:0e4f3bcb451e592db38325d1aaa13a454b8717b34b5a505c19bf6e38c330f545',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:f670dadff613322aa911ff5b6c96d3a538271a41a7dab6e7e548bf655df3c22a',
      'sha256:f5b2e1d8265d3c77f7a75f52bb9a9eed76e3c1c1342983fe3df0edcb42245c62',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.29","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.29/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260911195446',
      '{"minimum":"1.1.0","maximum":"1.2.29"}'::jsonb,
      'application',
      now()
    );
  END IF;

  PERFORM 1
  FROM public.plugins
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.1.0'
    AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
