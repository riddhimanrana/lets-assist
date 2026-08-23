-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.4';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '063f986f075b5b8d0e8979585edad771749bc17e'
      OR v_existing.manifest_hash IS DISTINCT FROM 'c9295e2c192b91cb3ed49d6af7637e259678da30e5d7498af280877c847f3978'
      OR v_existing.source_tree IS DISTINCT FROM 'e7dce8fee8a827bd3d2bde8ee9b279b121029333'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:1d9884fa94e5632d11bcda4c7645d81bc480d988ed1c52ed696c21de20e3e0f3'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:8e6c55817bf6a38385b8391124d6e43e97721ce42cb3de3ab5f62f877e828d7c'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:df74dc9b7e8e20b5555481c42a8fd25d722c820794c88a804079cf4ef53e7e7f'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.4","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.4/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260820130000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.4"}'::jsonb
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
      '1.2.4',
      'published',
      '## 1.2.4 - 2026-08-21

- Claimed a plugin-specific health route in the microfrontend group.
- Prevented deployment checks from resolving to the host application''s health endpoint.
',
      '063f986f075b5b8d0e8979585edad771749bc17e',
      'c9295e2c192b91cb3ed49d6af7637e259678da30e5d7498af280877c847f3978',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'e7dce8fee8a827bd3d2bde8ee9b279b121029333',
      'sha256:1d9884fa94e5632d11bcda4c7645d81bc480d988ed1c52ed696c21de20e3e0f3',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:8e6c55817bf6a38385b8391124d6e43e97721ce42cb3de3ab5f62f877e828d7c',
      'sha256:df74dc9b7e8e20b5555481c42a8fd25d722c820794c88a804079cf4ef53e7e7f',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.4","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.4/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260820130000',
      '{"minimum":"1.1.0","maximum":"1.2.4"}'::jsonb,
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
