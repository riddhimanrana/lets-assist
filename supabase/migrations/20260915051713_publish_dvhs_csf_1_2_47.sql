-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.47';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '6627d7a4ed30c32fdd687e5fb3738a83d52067f5'
      OR v_existing.manifest_hash IS DISTINCT FROM 'e25d4a1f92d987c3943dc791792049e4accb88401fa7c168901ac556ff8162a8'
      OR v_existing.source_tree IS DISTINCT FROM 'ae03519e7146383e430c0a1cc1d18de675a46eb9'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:e496422f9d60695466fd14284983634aca8f269092e3b30ba07d03e8e099ca21'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:ddc48714825d3426b2f4abefd946ef71eb3500bc66d25916e4f74a6e609fc799'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.47","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.47/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260915051000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.47"}'::jsonb
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
      '1.2.47',
      'published',
      '## 1.2.47

- Require the platform fixes for mixed-category resubmission, selected point limits, and current-term application intake before installation.
',
      '6627d7a4ed30c32fdd687e5fb3738a83d52067f5',
      'e25d4a1f92d987c3943dc791792049e4accb88401fa7c168901ac556ff8162a8',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'ae03519e7146383e430c0a1cc1d18de675a46eb9',
      'sha256:e496422f9d60695466fd14284983634aca8f269092e3b30ba07d03e8e099ca21',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:ddc48714825d3426b2f4abefd946ef71eb3500bc66d25916e4f74a6e609fc799',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.47","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.47/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260915051000',
      '{"minimum":"1.1.0","maximum":"1.2.47"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.47',
      code_reference = '6627d7a4ed30c32fdd687e5fb3738a83d52067f5',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.46'
    AND code_reference = '38fb682e6ac208fe122e3f3b90d6a916c9b0c7da';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.47'
      AND code_reference = '6627d7a4ed30c32fdd687e5fb3738a83d52067f5'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
