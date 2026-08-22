-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.1';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '37d0dbd414a64bf53076fe30450b38b1e90a4ec9'
      OR v_existing.manifest_hash IS DISTINCT FROM '3b510417bf5e8d8512cbe9f74a5cd3cd0faf894b9a1c8325001c2dbb7d2de3cb'
      OR v_existing.source_tree IS DISTINCT FROM 'afa6799615e1d0af2b14072fee26122c07ca37d6'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:689a9c24c4d931c331a100911db2ce7fb20061102d2e3dd192c2185f40c91e0e'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:dee24c38f33f33de934eeb1815d2b07daeb78135fb4b4a13f3cf4855497de15b'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:f315149d63f3c3a279e1ae0986d45acade45b0a3b2622be16ad54913f3a0a00c'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.1","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.1/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260820130000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.1"}'::jsonb
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
      '1.2.1',
      'published',
      '## 1.2.1 - 2026-08-20

- Packaged every Vercel function trace input so the signed application build can deploy on a separate runner.
- Kept archive paths and symlinks confined to the reviewed prebuilt application roots.
',
      '37d0dbd414a64bf53076fe30450b38b1e90a4ec9',
      '3b510417bf5e8d8512cbe9f74a5cd3cd0faf894b9a1c8325001c2dbb7d2de3cb',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'afa6799615e1d0af2b14072fee26122c07ca37d6',
      'sha256:689a9c24c4d931c331a100911db2ce7fb20061102d2e3dd192c2185f40c91e0e',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:dee24c38f33f33de934eeb1815d2b07daeb78135fb4b4a13f3cf4855497de15b',
      'sha256:f315149d63f3c3a279e1ae0986d45acade45b0a3b2622be16ad54913f3a0a00c',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.1","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.1/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260820130000',
      '{"minimum":"1.1.0","maximum":"1.2.1"}'::jsonb,
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
