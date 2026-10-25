-- Publish verified private releases together without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dv-speech-debate'
    AND version = '2.0.3';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd100831bd2fe3374715de20510d9ae2a77dcfba8'
      OR v_existing.manifest_hash IS DISTINCT FROM 'c01b1846be90ed60dfc8a862063a0e10d19507b403738998acc8369be151b203'
      OR v_existing.source_tree IS DISTINCT FROM 'c04f8a0dc45e4820aee4847afb32defdd7646fc3'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4494a5ffe6131dcc474ec9d64db5832754dbca5b2fdb61ded711a5c8f93c1395'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dv-speech-debate"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:ccb135724d41b41db0a067642536806134088fbdde881968bd81f18f6e364a45'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dv-speech-debate/v2.0.3","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dv-speech-debate/v2.0.3/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20261008020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"2.0.0","maximum":"2.0.3"}'::jsonb
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
      'dv-speech-debate',
      '2.0.3',
      'published',
      '## 2.0.3 - 2026-10-07

- Preserve the decision request after a business conflict until the saved result is confirmed. Require the platform migration that returns those conflicts without repeated database retries.
- Use atomic seasonal membership and review writes with retry receipts and stale-review checks.
- Declare membership write receipts as server-only data and require the platform migration that preserves calendar cleanup metadata on disconnect.
- Retire unsupported payment activation and legacy membership writes while accepting saved 2.0.x configuration. Existing installs remain pinned until an authorized control-plane update.
- Bound roster reads and remove sensitive values from runtime logs.
',
      'd100831bd2fe3374715de20510d9ae2a77dcfba8',
      'c01b1846be90ed60dfc8a862063a0e10d19507b403738998acc8369be151b203',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c04f8a0dc45e4820aee4847afb32defdd7646fc3',
      'sha256:4494a5ffe6131dcc474ec9d64db5832754dbca5b2fdb61ded711a5c8f93c1395',
      '["plugins/dv-speech-debate"]'::jsonb,
      NULL,
      'sha256:ccb135724d41b41db0a067642536806134088fbdde881968bd81f18f6e364a45',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dv-speech-debate/v2.0.3","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dv-speech-debate/v2.0.3/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0"}'::jsonb,
      1,
      '20261008020000',
      '{"minimum":"2.0.0","maximum":"2.0.3"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '2.0.3',
      code_reference = 'd100831bd2fe3374715de20510d9ae2a77dcfba8',
      updated_at = now()
  WHERE key = 'dv-speech-debate'
    AND latest_version = '2.0.2'
    AND code_reference = '99c3df1a7e9f39523c7a615017461c14ed88c7fc';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dv-speech-debate'
      AND latest_version = '2.0.3'
      AND code_reference = 'd100831bd2fe3374715de20510d9ae2a77dcfba8'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.86';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd100831bd2fe3374715de20510d9ae2a77dcfba8'
      OR v_existing.manifest_hash IS DISTINCT FROM 'df369b3179e7b0b8487d186f20bfa6b57defb43d48f2d1222d14e1b3d1d5d790'
      OR v_existing.source_tree IS DISTINCT FROM '1e9edea7dc9bd89e9ef28fb791b3deee31100214'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f2f9d7a29a716417bf88adf2e26ab8d0c7a1355f9b7c3027618a4de0afa997d3'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:5636166e7b4326d4e0d6aafcaa8c76978ca9ca3af55d9fde1df104b687e2ed62'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.86","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.86/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20261009030000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.86"}'::jsonb
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
      '1.2.86',
      'published',
      '## 1.2.86

- Preserve uncertain edit requests across business conflicts and require exact import receipt row coverage before reporting completion.
- Require the platform migration that returns business conflicts without repeated database retries.
- Keep the term-selection trigger disabled until its client handlers are ready.
- Check Sheet sync scope through the host RPC without loading record snapshots.
- Read calendar status through the authorized server credential boundary and require the platform migration that preserves cleanup metadata on disconnect.
- Keep shared Sheet parsing safe for browser imports and omit private record and provider details from runtime diagnostics.
- Retain the existing install range from 1.1.0. Existing installs remain pinned until an authorized control-plane update.
',
      'd100831bd2fe3374715de20510d9ae2a77dcfba8',
      'df369b3179e7b0b8487d186f20bfa6b57defb43d48f2d1222d14e1b3d1d5d790',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '1e9edea7dc9bd89e9ef28fb791b3deee31100214',
      'sha256:f2f9d7a29a716417bf88adf2e26ab8d0c7a1355f9b7c3027618a4de0afa997d3',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:5636166e7b4326d4e0d6aafcaa8c76978ca9ca3af55d9fde1df104b687e2ed62',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.86","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.86/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20261009030000',
      '{"minimum":"1.1.0","maximum":"1.2.86"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.86',
      code_reference = 'd100831bd2fe3374715de20510d9ae2a77dcfba8',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.85'
    AND code_reference = 'a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.86'
      AND code_reference = 'd100831bd2fe3374715de20510d9ae2a77dcfba8'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
