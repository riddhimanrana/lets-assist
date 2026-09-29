-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.84';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'e4f229d8b1f8b1aebcd3f3a03fb552108bd11a4c'
      OR v_existing.manifest_hash IS DISTINCT FROM '060d539b51a892a12b4a2859817819dc774f348c86f281d1c739652770937e35'
      OR v_existing.source_tree IS DISTINCT FROM '9753c9c5d0f06528adc1812c9afd9515fadb7b4f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:1ff88e63a26455e983b33cebe3c9083b9277f0e069067e5b5a2536da071ceefc'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:97690683624176a97b296dd7a25066ddf37858ec72af84db44d7b60cb85460ad'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.84","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.84/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260928025013'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.84"}'::jsonb
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
      '1.2.84',
      'published',
      '## 1.2.84

Account confirmation stays checked after a failed save so staff can retry the same request. The desktop and phone browser regression checks this flow without a written reason.
',
      'e4f229d8b1f8b1aebcd3f3a03fb552108bd11a4c',
      '060d539b51a892a12b4a2859817819dc774f348c86f281d1c739652770937e35',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '9753c9c5d0f06528adc1812c9afd9515fadb7b4f',
      'sha256:1ff88e63a26455e983b33cebe3c9083b9277f0e069067e5b5a2536da071ceefc',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:97690683624176a97b296dd7a25066ddf37858ec72af84db44d7b60cb85460ad',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.84","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.84/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260928025013',
      '{"minimum":"1.1.0","maximum":"1.2.84"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.84',
      code_reference = 'e4f229d8b1f8b1aebcd3f3a03fb552108bd11a4c',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.83'
    AND code_reference = '06afdd67ec9a6db6de84e17a7881faa9bc6b3591';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.84'
      AND code_reference = 'e4f229d8b1f8b1aebcd3f3a03fb552108bd11a4c'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
