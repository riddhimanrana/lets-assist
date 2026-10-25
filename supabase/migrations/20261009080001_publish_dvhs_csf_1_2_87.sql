-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.87';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '2c55aba805d50a981d1bc50c0755dcde5c7830ca'
      OR v_existing.manifest_hash IS DISTINCT FROM '3e09c5fa4e8695634ddcc1c93083359d51a7963dcb2ee1e0f6240cffa4017fa6'
      OR v_existing.source_tree IS DISTINCT FROM 'bf58526324f1209a17142c39796361d16a0d23da'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f3d80ca402f807edc8da800b2d69e431d5f4e2cb63435bbc34bd899305174f62'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:9b699cf53efe7107ba85f7091bd105e2910cc2c5ba0802bad04fba62984adf00'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.87","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.87/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20261009030000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.87"}'::jsonb
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
      '1.2.87',
      'published',
      '## 1.2.87

- Keep one primary action on the Members and term screens.
- Hide the officer setup prompt from public chapter visitors when no current term exists.
- Preserve existing installs until an authorized control-plane update.
',
      '2c55aba805d50a981d1bc50c0755dcde5c7830ca',
      '3e09c5fa4e8695634ddcc1c93083359d51a7963dcb2ee1e0f6240cffa4017fa6',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'bf58526324f1209a17142c39796361d16a0d23da',
      'sha256:f3d80ca402f807edc8da800b2d69e431d5f4e2cb63435bbc34bd899305174f62',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:9b699cf53efe7107ba85f7091bd105e2910cc2c5ba0802bad04fba62984adf00',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.87","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.87/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20261009030000',
      '{"minimum":"1.1.0","maximum":"1.2.87"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.87',
      code_reference = '2c55aba805d50a981d1bc50c0755dcde5c7830ca',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.86'
    AND code_reference = 'd100831bd2fe3374715de20510d9ae2a77dcfba8';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.87'
      AND code_reference = '2c55aba805d50a981d1bc50c0755dcde5c7830ca'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
