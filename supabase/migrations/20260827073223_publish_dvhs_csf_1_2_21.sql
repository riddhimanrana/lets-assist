-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.21';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'edfe65b338fd8dac65ddccc9114c2d7f723b6bb0'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd82f6493069ceada83ab08365c63206388cbe5b870b57fb35850da48d8f3ab65'
      OR v_existing.source_tree IS DISTINCT FROM '94b9efe95ac7c97fe4b241e0bdfdd0b81f5c949b'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:6b76a737378b9aebf62fd5b446d7169b35a0ff84166f45245709dd7f0f2facae'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:dda9b63c7830bfc83d512a435bfcf8cc2dce180095577eb6f072a2060f016d64'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:73b3c7f31d0bc19a5ee8fd24537f66f9f20ee9d30935cd88a4f8879915f89373'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.21","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.21/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260827020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.21"}'::jsonb
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
      '1.2.21',
      'published',
      '## 1.2.21 - 2026-08-27

- Continue imported-profile cleanup from an opaque server-derived cursor so a
  blocked batch cannot prevent later candidates from being checked.
- Return only aggregate merge-conflict categories while retaining the bounded
  database preview and merge checks.
',
      'edfe65b338fd8dac65ddccc9114c2d7f723b6bb0',
      'd82f6493069ceada83ab08365c63206388cbe5b870b57fb35850da48d8f3ab65',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '94b9efe95ac7c97fe4b241e0bdfdd0b81f5c949b',
      'sha256:6b76a737378b9aebf62fd5b446d7169b35a0ff84166f45245709dd7f0f2facae',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:dda9b63c7830bfc83d512a435bfcf8cc2dce180095577eb6f072a2060f016d64',
      'sha256:73b3c7f31d0bc19a5ee8fd24537f66f9f20ee9d30935cd88a4f8879915f89373',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.21","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.21/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260827020000',
      '{"minimum":"1.1.0","maximum":"1.2.21"}'::jsonb,
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
