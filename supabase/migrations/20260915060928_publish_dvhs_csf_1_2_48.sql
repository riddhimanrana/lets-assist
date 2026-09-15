-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.48';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd0d19e3bf451f83debe6524e916cbbb14991c4fd'
      OR v_existing.manifest_hash IS DISTINCT FROM 'b17d61248351abfab0c88d1b5184de3d986602d0b39ad200d84cdf6ce50afecb'
      OR v_existing.source_tree IS DISTINCT FROM 'cfe8742f4a295cdc678df193645e930045dea367'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:7fa97d609ba7dd98a3efdb11a982ad5cad141cd3316c46207e01078ee84d571d'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:8dc3201f3dffaca929978b12dccf87aa9cdb6d0dea4c7c5f7946e6735e881b1e'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.48","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.48/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260915054936'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.48"}'::jsonb
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
      '1.2.48',
      'published',
      '## 1.2.48

- Require the database protection against repeated fixed activity awards before installation.
',
      'd0d19e3bf451f83debe6524e916cbbb14991c4fd',
      'b17d61248351abfab0c88d1b5184de3d986602d0b39ad200d84cdf6ce50afecb',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'cfe8742f4a295cdc678df193645e930045dea367',
      'sha256:7fa97d609ba7dd98a3efdb11a982ad5cad141cd3316c46207e01078ee84d571d',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:8dc3201f3dffaca929978b12dccf87aa9cdb6d0dea4c7c5f7946e6735e881b1e',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.48","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.48/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260915054936',
      '{"minimum":"1.1.0","maximum":"1.2.48"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.48',
      code_reference = 'd0d19e3bf451f83debe6524e916cbbb14991c4fd',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.47'
    AND code_reference = '6627d7a4ed30c32fdd687e5fb3738a83d52067f5';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.48'
      AND code_reference = 'd0d19e3bf451f83debe6524e916cbbb14991c4fd'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
