-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.64';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '4eca3d9335611c637af732d876f2cc0066360f7a'
      OR v_existing.manifest_hash IS DISTINCT FROM '961aa2dae1bb43b49b39e74d2b10d6e8c78798e157a1571eb32cbcabce63579a'
      OR v_existing.source_tree IS DISTINCT FROM 'e2f9c79a0360f5aaaa843ae4e4f9a147f1557c82'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:cf189fa2d1835eddb5133e8450e274c134d025cf0fe6fa653fbf3090a24c17dd'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:df0db4a29c3a94c888a42332ed410fff3f0024e18394e7a4f226ed875c131c92'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.64","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.64/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.64"}'::jsonb
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
      '1.2.64',
      'published',
      '## 1.2.64

- Fill activity rows with the title, time, location, and points. Keep descriptions on the detail page and officer controls separate.
- Sort activities by earliest date, latest date, or title. Preserve search and week filters in the URL, reset paging when filters change, and put undated activities last.
- Show a shared calendar and selected-day agenda for any month. Read the full month in bounded pages with the existing membership and class restrictions.
- Remove the duplicate application correction button from My CSF. Keep "Something is wrong?" and correction history.
- Load activity details by their authorized ID so links from later catalog pages remain valid.
- Show exact official-workbook student-key evidence in duplicate merge previews, including legacy name differences. Keep database merge decisions and conflict checks unchanged.
',
      '4eca3d9335611c637af732d876f2cc0066360f7a',
      '961aa2dae1bb43b49b39e74d2b10d6e8c78798e157a1571eb32cbcabce63579a',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'e2f9c79a0360f5aaaa843ae4e4f9a147f1557c82',
      'sha256:cf189fa2d1835eddb5133e8450e274c134d025cf0fe6fa653fbf3090a24c17dd',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:df0db4a29c3a94c888a42332ed410fff3f0024e18394e7a4f226ed875c131c92',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.64","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.64/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.64"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.64',
      code_reference = '4eca3d9335611c637af732d876f2cc0066360f7a',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.63'
    AND code_reference = 'd57107a9efafe51abed7f07c25cec48c7b65cf03';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.64'
      AND code_reference = '4eca3d9335611c637af732d876f2cc0066360f7a'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
