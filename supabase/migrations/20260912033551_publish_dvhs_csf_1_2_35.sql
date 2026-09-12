-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.35';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '85fc9737fcc41049339163a92877d2605c551814'
      OR v_existing.manifest_hash IS DISTINCT FROM '120275a5af0ed127429a2aeddaf0c7893fd8ff6595c170a8286150c20778541a'
      OR v_existing.source_tree IS DISTINCT FROM '463abce54073f837f82dc17f81339bf1d865a91c'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:93c1b6fd8c5fa2fa4a4618494a2b260e709023ede8321ad42f759640405b6193'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:ae2d6aae4ecbf7e96c6def6f82c733c552656978cf3e463f1a782c6c11e8a150'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.35","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.35/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260912015608'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.35"}'::jsonb
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
      '1.2.35',
      'published',
      '## 1.2.35

- Sync application, point-submission, and class records without exporting discussions. New destinations leave Sheet comment cells untouched.
- Make account status and reported contacts easier to find in the member directory, and put account connection and review actions within reach.
- Count each configured import source once on Home when its range grows.
',
      '85fc9737fcc41049339163a92877d2605c551814',
      '120275a5af0ed127429a2aeddaf0c7893fd8ff6595c170a8286150c20778541a',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '463abce54073f837f82dc17f81339bf1d865a91c',
      'sha256:93c1b6fd8c5fa2fa4a4618494a2b260e709023ede8321ad42f759640405b6193',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:ae2d6aae4ecbf7e96c6def6f82c733c552656978cf3e463f1a782c6c11e8a150',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.35","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.35/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260912015608',
      '{"minimum":"1.1.0","maximum":"1.2.35"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.35',
      code_reference = '85fc9737fcc41049339163a92877d2605c551814',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.34'
    AND code_reference = 'bb7029dda2fafaa107eaad1f55003fce2ac19cab';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.35'
      AND code_reference = '85fc9737fcc41049339163a92877d2605c551814'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
