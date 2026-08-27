-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.19';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c02211ec5be9e2ff6a8ce5b6e2665178995d5fa5'
      OR v_existing.manifest_hash IS DISTINCT FROM 'df6a00b8c4e3fcc01ff087866102769b0215324e20b1ae202cfd4aed50af7f78'
      OR v_existing.source_tree IS DISTINCT FROM '6841e77c4c356a2583b495a9ea8ebedbe5a5d7e0'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:80fe2ddb54f9f631fb7cea23f2fedd985427a91420211ccb54bab06f96a936b5'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:9832b26e9f15865b502460211c1f94cf089e5e46031f82ab3d4b35a9bcaf7a59'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:4c4294ad2a57482fe9c7045d346d3d01425e417b1ad35cbed46f2f9beac68b94'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.19","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.19/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260827020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.19"}'::jsonb
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
      '1.2.19',
      'published',
      '## 1.2.19 - 2026-08-26

- Reuse exact linked-workbook profiles when repeated tab evidence points to the
  same immutable row.
- Add a bounded class cleanup that merges source-verified duplicates only when
  their semester history and database merge preview have no conflicts.
',
      'c02211ec5be9e2ff6a8ce5b6e2665178995d5fa5',
      'df6a00b8c4e3fcc01ff087866102769b0215324e20b1ae202cfd4aed50af7f78',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '6841e77c4c356a2583b495a9ea8ebedbe5a5d7e0',
      'sha256:80fe2ddb54f9f631fb7cea23f2fedd985427a91420211ccb54bab06f96a936b5',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:9832b26e9f15865b502460211c1f94cf089e5e46031f82ab3d4b35a9bcaf7a59',
      'sha256:4c4294ad2a57482fe9c7045d346d3d01425e417b1ad35cbed46f2f9beac68b94',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.19","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.19/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260827020000',
      '{"minimum":"1.1.0","maximum":"1.2.19"}'::jsonb,
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
