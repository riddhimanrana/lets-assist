-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.11';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd300287979f51d3e30dd04ceb30f8785ac4e9ebc'
      OR v_existing.manifest_hash IS DISTINCT FROM 'f342a40f33aa5f605d4306f070ddc3a97a3e0e90a938d5f196723af950ea68d5'
      OR v_existing.source_tree IS DISTINCT FROM '55d2ae578060ec4ac180ea311c89e11acd2dc303'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:8baadcbcd944733ff52ce2411847e7bd091537e9d5c8a44146cadb15711f9adb'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:e542a75902f7793285c7513e38864819dbb77560b7ecdcf8f1bcb60d3bc3242f'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:77022c66d8b3ac639fe2c305e426e770331d708b55e1fe5316742a4415e4710f'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.11","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.11/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260824123000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.11"}'::jsonb
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
      '1.2.11',
      'published',
      '## 1.2.11 - 2026-08-24

- Selected member email by default when an activity is first published from
  either the create form or a saved draft.
- Kept the choice explicit so the publisher can clear it before submission.
- Required the class-scoped member-count schema now present in Production.
',
      'd300287979f51d3e30dd04ceb30f8785ac4e9ebc',
      'f342a40f33aa5f605d4306f070ddc3a97a3e0e90a938d5f196723af950ea68d5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '55d2ae578060ec4ac180ea311c89e11acd2dc303',
      'sha256:8baadcbcd944733ff52ce2411847e7bd091537e9d5c8a44146cadb15711f9adb',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:e542a75902f7793285c7513e38864819dbb77560b7ecdcf8f1bcb60d3bc3242f',
      'sha256:77022c66d8b3ac639fe2c305e426e770331d708b55e1fe5316742a4415e4710f',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.11","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.11/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260824123000',
      '{"minimum":"1.1.0","maximum":"1.2.11"}'::jsonb,
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
