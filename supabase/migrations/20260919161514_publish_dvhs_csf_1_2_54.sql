-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.54';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c7274ecd602ed499f008b966741c7f704dd9cb11'
      OR v_existing.manifest_hash IS DISTINCT FROM 'a818de987740c5cddd7233cd7d885e835bd397bb48df826c4610242b9da22c84'
      OR v_existing.source_tree IS DISTINCT FROM '6d0742faca27c638c983c3be65e4a1ec11eabb94'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:c690ccfe4b183db4ad97bc2365130c0c8b052711cb7f0118ad8ddbe47dc1d787'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:9827939d43e5ba5c1b954a5b066d5536c3b1451ab02154095fa7692146ea3ee1'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.54","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.54/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260919155040'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.54"}'::jsonb
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
      '1.2.54',
      'published',
      '## 1.2.54

- Fence proof-storage cleanup with claimed queue work, retry-safe acknowledgments, and pre-upload restoration checks.
- During plugin teardown, enqueue attachment cleanup, remove and acknowledge the organization''s Storage objects, then finalize cleanup state only after the queue is confirmed empty.
',
      'c7274ecd602ed499f008b966741c7f704dd9cb11',
      'a818de987740c5cddd7233cd7d885e835bd397bb48df826c4610242b9da22c84',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '6d0742faca27c638c983c3be65e4a1ec11eabb94',
      'sha256:c690ccfe4b183db4ad97bc2365130c0c8b052711cb7f0118ad8ddbe47dc1d787',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:9827939d43e5ba5c1b954a5b066d5536c3b1451ab02154095fa7692146ea3ee1',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.54","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.54/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260919155040',
      '{"minimum":"1.1.0","maximum":"1.2.54"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.54',
      code_reference = 'c7274ecd602ed499f008b966741c7f704dd9cb11',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.53'
    AND code_reference = '11d3f531b4b74ef9dd0a3a332604a4c80b835448';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.54'
      AND code_reference = 'c7274ecd602ed499f008b966741c7f704dd9cb11'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
