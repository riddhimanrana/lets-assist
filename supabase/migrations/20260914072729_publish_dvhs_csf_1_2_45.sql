-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.45';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '135bfa3a3c1bc7b2d1608fec215c517631380c49'
      OR v_existing.manifest_hash IS DISTINCT FROM 'c5f96d7dbfd92a0459be94d8cde2989eff6cdd33f4f56a942e3265630008eaeb'
      OR v_existing.source_tree IS DISTINCT FROM 'b2f6884790e1405dd40515ea4e5a95f6501a70eb'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:6d079418a19a5e3c5730b21718043a95192f975a86b16c5e0aea06ed6926fce6'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:82cbf6dd751b535971d79abb6deb7536f3b3e57faa3d3dfcc015cb0866d65ca7'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.45","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.45/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260914033117'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.45"}'::jsonb
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
      '1.2.45',
      'published',
      '## 1.2.45

- Give authorized staff profile searches a separate review quota while preserving student join limits.
- Start the first automatic application preview from the preview approved when updates were enabled. Keep later refreshes tied to their own source history and reject stale authorization or lease data.
',
      '135bfa3a3c1bc7b2d1608fec215c517631380c49',
      'c5f96d7dbfd92a0459be94d8cde2989eff6cdd33f4f56a942e3265630008eaeb',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'b2f6884790e1405dd40515ea4e5a95f6501a70eb',
      'sha256:6d079418a19a5e3c5730b21718043a95192f975a86b16c5e0aea06ed6926fce6',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:82cbf6dd751b535971d79abb6deb7536f3b3e57faa3d3dfcc015cb0866d65ca7',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.45","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.45/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260914033117',
      '{"minimum":"1.1.0","maximum":"1.2.45"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.45',
      code_reference = '135bfa3a3c1bc7b2d1608fec215c517631380c49',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.44'
    AND code_reference = 'c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.45'
      AND code_reference = '135bfa3a3c1bc7b2d1608fec215c517631380c49'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
