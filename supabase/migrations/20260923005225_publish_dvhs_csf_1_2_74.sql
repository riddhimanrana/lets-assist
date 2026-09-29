-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.74';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'f6ca8e2097f64381499d5a79c1bdfdce5e282d7a'
      OR v_existing.manifest_hash IS DISTINCT FROM 'dbd6080e20f7ed3845cd7345b5e94c4f8817c035edade0fa1c8b0fd923248b0a'
      OR v_existing.source_tree IS DISTINCT FROM 'f9aff25e68236db41c9a2963bbcd852bc3d6fc86'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:35fa13bfb82f22d0fb4b087268de911cff6939e0746025e98940ca474860bd1e'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:fa6fce7d2bf12f6b26d8d1d4f56c010be25af08695b683c147348b62b8515349'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.74","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.74/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922232103'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.74"}'::jsonb
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
      '1.2.74',
      'published',
      '## 1.2.74

Activity lists show their semester and remain empty when no valid semester is selected. Creating an activity from a class workspace retains that class and its selected semester. Current lists keep historical activities in their original terms, with detail links and existing credits preserved.
',
      'f6ca8e2097f64381499d5a79c1bdfdce5e282d7a',
      'dbd6080e20f7ed3845cd7345b5e94c4f8817c035edade0fa1c8b0fd923248b0a',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'f9aff25e68236db41c9a2963bbcd852bc3d6fc86',
      'sha256:35fa13bfb82f22d0fb4b087268de911cff6939e0746025e98940ca474860bd1e',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:fa6fce7d2bf12f6b26d8d1d4f56c010be25af08695b683c147348b62b8515349',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.74","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.74/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922232103',
      '{"minimum":"1.1.0","maximum":"1.2.74"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.74',
      code_reference = 'f6ca8e2097f64381499d5a79c1bdfdce5e282d7a',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.73'
    AND code_reference = '289558fca951efe404b3481b56a0d855a4db29e3';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.74'
      AND code_reference = 'f6ca8e2097f64381499d5a79c1bdfdce5e282d7a'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
