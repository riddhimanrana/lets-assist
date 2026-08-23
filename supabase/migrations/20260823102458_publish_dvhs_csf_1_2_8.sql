-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.8';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'de80116b305f4d200aba767b18e508867b66e8e3'
      OR v_existing.manifest_hash IS DISTINCT FROM '1cc0e5ccc8c1a2a9f37b2ff8e95660d4158ab9fabefb50fcebc8285d78aafda5'
      OR v_existing.source_tree IS DISTINCT FROM 'efcc24d2cd22a823dfda1cc6bdc21149dd762a5d'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:19c4790d1459d95c2efbc308c1ac1b9fd3582a7d4ba19e96565a316334a7313b'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:769a341af3bbdbc192d7537640c284036aa78971e5a49197b9e5c516fd1126c3'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:0bcf4991f59892db1e05c4be0920d8d56c169fca918f6b325e8e5b910c4b8d60'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.8","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.8/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260822044742'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.8"}'::jsonb
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
      '1.2.8',
      'published',
      '## 1.2.8 - 2026-08-23

- Published the current application runtime through the signed release and automatic root integration flow.
',
      'de80116b305f4d200aba767b18e508867b66e8e3',
      '1cc0e5ccc8c1a2a9f37b2ff8e95660d4158ab9fabefb50fcebc8285d78aafda5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'efcc24d2cd22a823dfda1cc6bdc21149dd762a5d',
      'sha256:19c4790d1459d95c2efbc308c1ac1b9fd3582a7d4ba19e96565a316334a7313b',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:769a341af3bbdbc192d7537640c284036aa78971e5a49197b9e5c516fd1126c3',
      'sha256:0bcf4991f59892db1e05c4be0920d8d56c169fca918f6b325e8e5b910c4b8d60',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.8","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.8/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260822044742',
      '{"minimum":"1.1.0","maximum":"1.2.8"}'::jsonb,
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
