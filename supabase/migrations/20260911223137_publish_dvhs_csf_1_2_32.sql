-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.32';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'a9f528ee4b49bb7619e3488a8dfa98dcadc5ef35'
      OR v_existing.manifest_hash IS DISTINCT FROM '909fa720dab454723adc8d6effcc28c282403d8d14f65b2e6d818dc19343176f'
      OR v_existing.source_tree IS DISTINCT FROM '52d3b3cd16e6bd7739e00c1b709f148ce5242e6b'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:d39258841bc7c2ed0acb71cc3116c05ec2c13de7355fc5641b60a918873d79c3'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:4fd4efaccc47c0f3072d3ae0604b615e1026e5498b8b7322a49596f91451a772'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:b44f2ccc12df1f151e57a15784ef26d0cc80d3607bb82d2fc8ed267118eddff9'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.32","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.32/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260911203901'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.32"}'::jsonb
      OR v_existing.runtime_profile IS DISTINCT FROM 'application'
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
      '1.2.32',
      'published',
      '## 1.2.32

- Copy test workbooks directly to the My Drive root alias without requiring access to read that folder. Verify the new copy remains private before recording success.
',
      'a9f528ee4b49bb7619e3488a8dfa98dcadc5ef35',
      '909fa720dab454723adc8d6effcc28c282403d8d14f65b2e6d818dc19343176f',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '52d3b3cd16e6bd7739e00c1b709f148ce5242e6b',
      'sha256:d39258841bc7c2ed0acb71cc3116c05ec2c13de7355fc5641b60a918873d79c3',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:4fd4efaccc47c0f3072d3ae0604b615e1026e5498b8b7322a49596f91451a772',
      'sha256:b44f2ccc12df1f151e57a15784ef26d0cc80d3607bb82d2fc8ed267118eddff9',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.32","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.32/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260911203901',
      '{"minimum":"1.1.0","maximum":"1.2.32"}'::jsonb,
      'application',
      now()
    );
  END IF;

  PERFORM 1
  FROM public.plugins
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.1.0'
    AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
