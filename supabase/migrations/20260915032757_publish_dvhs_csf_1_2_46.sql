-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.46';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '38fb682e6ac208fe122e3f3b90d6a916c9b0c7da'
      OR v_existing.manifest_hash IS DISTINCT FROM '4a3b40a6dfff8cb96beebbb1268b69084853f3f993463f1d09c055f96a02be85'
      OR v_existing.source_tree IS DISTINCT FROM '40f664f3651e0dff2e6a964cb77faacebc9da18f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:53b38218bd8396dee4f4a25191f5eee1c2003c41eb0312b8c2f88756650819e2'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:e116f5645b9e45d7ce170db0250e47a1a0b7f784f0fa416dae95c28e1e9340d2'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.46","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.46/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260914160000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.46"}'::jsonb
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
      '1.2.46',
      'published',
      '## 1.2.46

- Simplify Sheet sync controls, preserve direct source links, and reuse application and class workbooks by immutable Drive file ID.
- Review applications across all classes or one class, and split the visible unassigned applications among reviewers.
- Let authorized officers open or close new applications manually while keeping the current term lifecycle and public-link checks.
- Support flexible activity point values and separate shift submissions without changing verified award history.
- Search account-connection requests by student or login details and confirm the selected fixed login in place through the existing staff verification action.
',
      '38fb682e6ac208fe122e3f3b90d6a916c9b0c7da',
      '4a3b40a6dfff8cb96beebbb1268b69084853f3f993463f1d09c055f96a02be85',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '40f664f3651e0dff2e6a964cb77faacebc9da18f',
      'sha256:53b38218bd8396dee4f4a25191f5eee1c2003c41eb0312b8c2f88756650819e2',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:e116f5645b9e45d7ce170db0250e47a1a0b7f784f0fa416dae95c28e1e9340d2',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.46","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.46/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260914160000',
      '{"minimum":"1.1.0","maximum":"1.2.46"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.46',
      code_reference = '38fb682e6ac208fe122e3f3b90d6a916c9b0c7da',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.45'
    AND code_reference = '135bfa3a3c1bc7b2d1608fec215c517631380c49';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.46'
      AND code_reference = '38fb682e6ac208fe122e3f3b90d6a916c9b0c7da'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
