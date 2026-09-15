-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.50';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1726e639955c3259ce7565879fd3195a369fb3c3'
      OR v_existing.manifest_hash IS DISTINCT FROM 'fe0db69b5f2c27acc885641ecdf5021bf22cb7ec48d2ae29560cf64543f72f67'
      OR v_existing.source_tree IS DISTINCT FROM '0b2fd1ca90f20ef05cf77c4db909e1a6c9f96226'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:35d2d1760cf21e8f0f553c2ef5ae45dfeae92ebaddd7dc4073ac02a4218faaec'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:a86cf03fb116159fac00c16ed8f443066cdfb807fbb6a2d3b14491a2101f2ad7'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.50","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.50/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260915161000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.50"}'::jsonb
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
      '1.2.50',
      'published',
      '## 1.2.50

- Preserve a selected graduating class when reopening or duplicating an activity from Activities. If that class cannot be loaded, block editing instead of silently changing its audience.
',
      '1726e639955c3259ce7565879fd3195a369fb3c3',
      'fe0db69b5f2c27acc885641ecdf5021bf22cb7ec48d2ae29560cf64543f72f67',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '0b2fd1ca90f20ef05cf77c4db909e1a6c9f96226',
      'sha256:35d2d1760cf21e8f0f553c2ef5ae45dfeae92ebaddd7dc4073ac02a4218faaec',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:a86cf03fb116159fac00c16ed8f443066cdfb807fbb6a2d3b14491a2101f2ad7',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.50","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.50/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260915161000',
      '{"minimum":"1.1.0","maximum":"1.2.50"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.50',
      code_reference = '1726e639955c3259ce7565879fd3195a369fb3c3',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.49'
    AND code_reference = 'deb220b48422507f6a406c0911433577a0c08391';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.50'
      AND code_reference = '1726e639955c3259ce7565879fd3195a369fb3c3'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
