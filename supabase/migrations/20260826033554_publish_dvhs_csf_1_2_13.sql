-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.13';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '23463d6351150ea6f838e56563c1d30f8b3e85a3'
      OR v_existing.manifest_hash IS DISTINCT FROM '055c6db3ef8b394374c9392fe34e8a360d32c9f439cd4dcc73f4d390d9bd888b'
      OR v_existing.source_tree IS DISTINCT FROM '7c2747ecd1dcff4c7ed9734885aa2ce957106d9f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:cdf9aee190050c52281a1404c465cf98e0d56188503798b8145b5dccda002b01'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:4d318ea7a039569f46e31425b1f27583c0d16351a581f3a5e7ac6a77546dea29'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:a0fc753d54ed2e932ed4c04999c89aea4aee168648544e17791d548f8175f67c'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.13","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.13/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.13"}'::jsonb
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
      '1.2.13',
      'published',
      '## 1.2.13 - 2026-08-25

- Give reusable CSF combobox triggers their visible field label as an
  accessible name, including the combined staff `Person` picker.
',
      '23463d6351150ea6f838e56563c1d30f8b3e85a3',
      '055c6db3ef8b394374c9392fe34e8a360d32c9f439cd4dcc73f4d390d9bd888b',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '7c2747ecd1dcff4c7ed9734885aa2ce957106d9f',
      'sha256:cdf9aee190050c52281a1404c465cf98e0d56188503798b8145b5dccda002b01',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:4d318ea7a039569f46e31425b1f27583c0d16351a581f3a5e7ac6a77546dea29',
      'sha256:a0fc753d54ed2e932ed4c04999c89aea4aee168648544e17791d548f8175f67c',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.13","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.13/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.13"}'::jsonb,
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
