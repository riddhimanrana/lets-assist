-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.27';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1af9b2208f761bf02e935142b52686fce7bf2f40'
      OR v_existing.manifest_hash IS DISTINCT FROM 'f2a9e42468493978d58d4e1f05ddac49fd16df505604e94e9142b3d2178448ff'
      OR v_existing.source_tree IS DISTINCT FROM 'b63f8f5daaa655eb66d4bb7c1d93b0e917523ed9'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:b1311e70e3aa3bd9e18a9ae4b40d3982ebe2ae4287358d7c62529f3a4f646211'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:25684e4df4acf5cca8e24252fef664c48dc267c0c19caed289fd0586bcec2e2f'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:c04902327b0a2d838adbbeff725b0e0f6e8aa59b4d1701ec1329502182707026'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.27","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.27/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260910232532'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.27"}'::jsonb
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
      '1.2.27',
      'published',
      '## 1.2.27

- Skip unused point submission records on officer Home. Keep the pending count from the authorized dashboard snapshot and preserve the record reads on submission screens.
',
      '1af9b2208f761bf02e935142b52686fce7bf2f40',
      'f2a9e42468493978d58d4e1f05ddac49fd16df505604e94e9142b3d2178448ff',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'b63f8f5daaa655eb66d4bb7c1d93b0e917523ed9',
      'sha256:b1311e70e3aa3bd9e18a9ae4b40d3982ebe2ae4287358d7c62529f3a4f646211',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:25684e4df4acf5cca8e24252fef664c48dc267c0c19caed289fd0586bcec2e2f',
      'sha256:c04902327b0a2d838adbbeff725b0e0f6e8aa59b4d1701ec1329502182707026',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.27","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.27/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260910232532',
      '{"minimum":"1.1.0","maximum":"1.2.27"}'::jsonb,
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
