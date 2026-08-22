-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.3';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'f24b8db52f3f761e6282907b97280cb4de77a733'
      OR v_existing.manifest_hash IS DISTINCT FROM 'c85243e5f5260e05497742cad16628e73df29e9c7992c1d0fc965bdd0c347934'
      OR v_existing.source_tree IS DISTINCT FROM 'ebf7281f224aafe8ba2531764c294804f0c858c0'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f6daed244fb3f1fd5b2efeeea41b1731d00559ecce23f5dcfecb264f97514259'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:4e719f6480b96c0777a247a069090e0fe2068abbd6fa3c1d207f94b711ea1e89'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:c48d18aa91c8145f61253538d71e6615653716027f1197f61d0bcec2678ca342'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.3","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.3/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260820130000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.3"}'::jsonb
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
      '1.2.3',
      'published',
      '## 1.2.3 - 2026-08-21

- Built the signed Development artifact for Vercel''s supported Preview lane.
- Kept the Production artifact bound to the Production environment.
',
      'f24b8db52f3f761e6282907b97280cb4de77a733',
      'c85243e5f5260e05497742cad16628e73df29e9c7992c1d0fc965bdd0c347934',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'ebf7281f224aafe8ba2531764c294804f0c858c0',
      'sha256:f6daed244fb3f1fd5b2efeeea41b1731d00559ecce23f5dcfecb264f97514259',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:4e719f6480b96c0777a247a069090e0fe2068abbd6fa3c1d207f94b711ea1e89',
      'sha256:c48d18aa91c8145f61253538d71e6615653716027f1197f61d0bcec2678ca342',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.3","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.3/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260820130000',
      '{"minimum":"1.1.0","maximum":"1.2.3"}'::jsonb,
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
