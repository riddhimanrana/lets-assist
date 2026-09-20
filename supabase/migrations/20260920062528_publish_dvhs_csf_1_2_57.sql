-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.57';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c5c285597ea36359780e572039f8a0e7c1d5dc41'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd0b44ae2bbab63e5d9c99ee04339ed4919f58f3f2a16223baaaa9ccaad60eb24'
      OR v_existing.source_tree IS DISTINCT FROM '855b647df843048610c7cdb1edf4ade4cfff9a25'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:9baeb8f741642a05a2a09557acaa1109db2cdc45a325e2907ac7c82748eeaaeb'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:94596065c2429bfe72da0e71f9b6c4e3f88cb23c19bb1f82ce62a1f0aa9f6138'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.57","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.57/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.57"}'::jsonb
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
      '1.2.57',
      'published',
      '## 1.2.57

- Match attendance searches across separate first and last name fields.

- Show attendance search results in the match selector immediately while preserving entered review notes.
',
      'c5c285597ea36359780e572039f8a0e7c1d5dc41',
      'd0b44ae2bbab63e5d9c99ee04339ed4919f58f3f2a16223baaaa9ccaad60eb24',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '855b647df843048610c7cdb1edf4ade4cfff9a25',
      'sha256:9baeb8f741642a05a2a09557acaa1109db2cdc45a325e2907ac7c82748eeaaeb',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:94596065c2429bfe72da0e71f9b6c4e3f88cb23c19bb1f82ce62a1f0aa9f6138',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.57","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.57/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920020000',
      '{"minimum":"1.1.0","maximum":"1.2.57"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.57',
      code_reference = 'c5c285597ea36359780e572039f8a0e7c1d5dc41',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.56'
    AND code_reference = '593bddcab92ce700b108ff02cd802293baf02c72';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.57'
      AND code_reference = 'c5c285597ea36359780e572039f8a0e7c1d5dc41'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
