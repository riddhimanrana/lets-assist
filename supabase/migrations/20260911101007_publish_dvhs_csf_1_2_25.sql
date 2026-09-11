-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.25';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'fa78eeb753ab0af537490fc2b0b62e7b3bf67a3e'
      OR v_existing.manifest_hash IS DISTINCT FROM 'bf77c77f2a62e71dbe3249b2d3c8634192f665a15ef3dada65f48786016a95f9'
      OR v_existing.source_tree IS DISTINCT FROM 'cfe8418ad4d4102ee92ce36b7910734abfa6a866'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:05886f20b5f21148b3d4cde632d17926266d2e8029756b01264ce1cd3b5cc9a8'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:aac9129e4f157cb88029c3f9f62dc50062cd31a8b3d3aee6712dfc0d68ff3f60'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:0f7b5eaf6f5eb8b0ab1fdc64bc95ca8fe0bcdc398b5a1697f69c461ba97f33d9'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.25","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.25/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260910232532'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.25"}'::jsonb
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
      '1.2.25',
      'published',
      '## 1.2.25

- Allow an authorized successor to review an unconfirmed test copy using the original Google account and independent outcome evidence.
- Require documented staff review before retrying an unconfirmed test copy. Clarify class joining and fix server-rendered invitation styles.
- Add restricted Sheet destinations for applications, point submissions, and class records. Sheet decisions wait for staff review.
- Preserve native cell discussions, replies, and resolution. Uncertain writes stop for reconciliation.
- Keep account connection, enrollment, verified points, and historical completion separate.
- Use current import readiness on Home and open synced records directly in their review screen.
- Start testing with server-created workbook copies and separate record IDs. Require audited test results and fresh row and native-thread checks before live sync.
',
      'fa78eeb753ab0af537490fc2b0b62e7b3bf67a3e',
      'bf77c77f2a62e71dbe3249b2d3c8634192f665a15ef3dada65f48786016a95f9',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'cfe8418ad4d4102ee92ce36b7910734abfa6a866',
      'sha256:05886f20b5f21148b3d4cde632d17926266d2e8029756b01264ce1cd3b5cc9a8',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:aac9129e4f157cb88029c3f9f62dc50062cd31a8b3d3aee6712dfc0d68ff3f60',
      'sha256:0f7b5eaf6f5eb8b0ab1fdc64bc95ca8fe0bcdc398b5a1697f69c461ba97f33d9',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.25","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.25/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260910232532',
      '{"minimum":"1.1.0","maximum":"1.2.25"}'::jsonb,
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
