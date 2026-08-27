-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.16';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd4b96e89de74eaa29c1236293d5e1dcca483c166'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd20be2cbaaba93c66931d6cb9dbb3d48b5b3857ca72f281e71a19eaebaaac0c3'
      OR v_existing.source_tree IS DISTINCT FROM '604cd791004cdaae4260fcde91eeabb7ad524808'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:0c8ff55f4c3ce4aa0d383289d830e261bd70954903376a398f69940a37c41d1a'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:ae46e9a771e6496475e286b5f2eee3978993f1acb23d2342c36fbfed8a4eb345'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:a631b0e02de4b791f625f30e13a2a5118c7f7f6145512106f4789bb4ee517969'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.16","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.16/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.16"}'::jsonb
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
      '1.2.16',
      'published',
      '## 1.2.16 - 2026-08-26

- Reuse the one profile already established by the same class workbook when
  exact-name candidates would otherwise block a later semester. Multiple
  source-backed candidates still require officer review.
- Treat header-only semester tabs as having no student rows instead of sending
  them into commit readiness with an incomplete-snapshot error.
',
      'd4b96e89de74eaa29c1236293d5e1dcca483c166',
      'd20be2cbaaba93c66931d6cb9dbb3d48b5b3857ca72f281e71a19eaebaaac0c3',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '604cd791004cdaae4260fcde91eeabb7ad524808',
      'sha256:0c8ff55f4c3ce4aa0d383289d830e261bd70954903376a398f69940a37c41d1a',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:ae46e9a771e6496475e286b5f2eee3978993f1acb23d2342c36fbfed8a4eb345',
      'sha256:a631b0e02de4b791f625f30e13a2a5118c7f7f6145512106f4789bb4ee517969',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.16","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.16/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.16"}'::jsonb,
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
