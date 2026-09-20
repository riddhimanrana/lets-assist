-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.56';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '593bddcab92ce700b108ff02cd802293baf02c72'
      OR v_existing.manifest_hash IS DISTINCT FROM '857f0b7623560e1890c56ae9229b19862113ce3d31c99bd691e9d68d7b6cd780'
      OR v_existing.source_tree IS DISTINCT FROM '736fb02aceaba0ffa8d4bfde3b22105ea443d7dc'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:c39556ddcbbb94e6d20159dde7e78fc3b675a5521337c0215658c4b35b0cb193'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:67c67bfa32bf816ee838519b18180f4bba02880de9642c9ae2aa53bd79ef9576'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.56","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.56/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.56"}'::jsonb
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
      '1.2.56',
      'published',
      '## 1.2.56

- Include pending applicants in officer attendance record searches.

- Separate saving post drafts from publishing, with email sent only for publication.
- Show published class activities in the officer stream with direct activity links.
- Allow audited deletion of unused activities while preserving participation, points, and email history.
',
      '593bddcab92ce700b108ff02cd802293baf02c72',
      '857f0b7623560e1890c56ae9229b19862113ce3d31c99bd691e9d68d7b6cd780',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '736fb02aceaba0ffa8d4bfde3b22105ea443d7dc',
      'sha256:c39556ddcbbb94e6d20159dde7e78fc3b675a5521337c0215658c4b35b0cb193',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:67c67bfa32bf816ee838519b18180f4bba02880de9642c9ae2aa53bd79ef9576',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.56","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.56/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920020000',
      '{"minimum":"1.1.0","maximum":"1.2.56"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.56',
      code_reference = '593bddcab92ce700b108ff02cd802293baf02c72',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.55'
    AND code_reference = '1888ca808a2c9a532098b3ea3ae5dd13eb300150';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.56'
      AND code_reference = '593bddcab92ce700b108ff02cd802293baf02c72'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
