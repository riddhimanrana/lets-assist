-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.44';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae'
      OR v_existing.manifest_hash IS DISTINCT FROM '84161e386c01937da736143cda8ef1c558923b63f9df402b2f553f9c297c91cb'
      OR v_existing.source_tree IS DISTINCT FROM '4c47e3984a0baee5c8445534950e55c1c86ce535'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:7397c2ee011bcd1866d31f0917ff99c4d01d553131b911625966f0fff6da6f6e'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:da350d09463883f7ba7d5cec47a9712266176fa4cff115e544898585c152506c'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.44","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.44/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260914033117'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.44"}'::jsonb
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
      '1.2.44',
      'published',
      '## 1.2.44

- Deliver new post and activity notices through the platform notification bell, with current audience and organization-update preference checks before delivery. Keep private post content out of notification text.
- Respect account email and organization-update preferences alongside chapter topic consent before sending publication email. Keep the existing publish email option and delivery controls.
',
      'c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae',
      '84161e386c01937da736143cda8ef1c558923b63f9df402b2f553f9c297c91cb',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '4c47e3984a0baee5c8445534950e55c1c86ce535',
      'sha256:7397c2ee011bcd1866d31f0917ff99c4d01d553131b911625966f0fff6da6f6e',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:da350d09463883f7ba7d5cec47a9712266176fa4cff115e544898585c152506c',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.44","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.44/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260914033117',
      '{"minimum":"1.1.0","maximum":"1.2.44"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.44',
      code_reference = 'c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.43'
    AND code_reference = 'c91f8448645f30c9375867b312e01275b2aca5ec';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.44'
      AND code_reference = 'c2cfe6bee781c5d94c4fab0c05b62d0134e5f8ae'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
