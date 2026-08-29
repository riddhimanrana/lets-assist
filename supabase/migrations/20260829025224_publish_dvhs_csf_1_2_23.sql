-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.23';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '30a74106a2ce034f447d7e8275e9c449a8f21e7f'
      OR v_existing.manifest_hash IS DISTINCT FROM 'a4cba770ab3140a63998368025e6ca28b9c4f1c07d26ae01919317af757d17d5'
      OR v_existing.source_tree IS DISTINCT FROM '46a28a19c9d5e6e4016857b103a1065f631e2603'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:1c47c5d63c5054a16fbbb868b4196a22e97f83a844db6f0a3366eb457c25ce96'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:ac6313cf168c16f975d97f912753e54c725a2d841a8521993bff8163fea97b43'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:5ed61926dcdef3cbbc4c940b6b72ab8d4bf74b2af1cb1b2138a1580947cb2f25'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.23","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.23/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260829020011'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.23"}'::jsonb
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
      '1.2.23',
      'published',
      '## 1.2.23 - 2026-08-29

- Store one canonical imported activity per semester and link each member''s
  exact award to it.
- Link class-workbook attendance to shared meetings and sessions.
- Replace the public CSF entry page with a class-first join flow and a split
  six-character code input.
- Shorten the student record connection flow and show its current stage.
',
      '30a74106a2ce034f447d7e8275e9c449a8f21e7f',
      'a4cba770ab3140a63998368025e6ca28b9c4f1c07d26ae01919317af757d17d5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '46a28a19c9d5e6e4016857b103a1065f631e2603',
      'sha256:1c47c5d63c5054a16fbbb868b4196a22e97f83a844db6f0a3366eb457c25ce96',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:ac6313cf168c16f975d97f912753e54c725a2d841a8521993bff8163fea97b43',
      'sha256:5ed61926dcdef3cbbc4c940b6b72ab8d4bf74b2af1cb1b2138a1580947cb2f25',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.23","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.23/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260829020011',
      '{"minimum":"1.1.0","maximum":"1.2.23"}'::jsonb,
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
