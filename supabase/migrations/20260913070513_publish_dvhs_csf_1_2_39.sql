-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.39';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'ddd6a931fc56f8dd92d953da5782e2e7cf77d5f0'
      OR v_existing.manifest_hash IS DISTINCT FROM '302fcde1fca8256215bca05edd2056808797ed7e9e8fe936c30693477bd5ec04'
      OR v_existing.source_tree IS DISTINCT FROM '90e2929c9d4b54b560a8ecd340b8ce7443ae9e7d'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f4fbbbbecdb9d511faa37f9301161b5459b8c60ce47f46141985e54e15695179'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:35114ba2bc8f9d845eefc61d2690e5ebfe45c0b27d4511396e54ab0f90b98c69'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.39","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.39/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260913061610'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.39"}'::jsonb
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
      '1.2.39',
      'published',
      '## 1.2.39

- Require the database migrations that support creating, editing, and publishing activities without a date before installing this release.
',
      'ddd6a931fc56f8dd92d953da5782e2e7cf77d5f0',
      '302fcde1fca8256215bca05edd2056808797ed7e9e8fe936c30693477bd5ec04',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '90e2929c9d4b54b560a8ecd340b8ce7443ae9e7d',
      'sha256:f4fbbbbecdb9d511faa37f9301161b5459b8c60ce47f46141985e54e15695179',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:35114ba2bc8f9d845eefc61d2690e5ebfe45c0b27d4511396e54ab0f90b98c69',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.39","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.39/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260913061610',
      '{"minimum":"1.1.0","maximum":"1.2.39"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.39',
      code_reference = 'ddd6a931fc56f8dd92d953da5782e2e7cf77d5f0',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.38'
    AND code_reference = '3fbabfba4fb275a38c13d18558de94f15f1213cd';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.39'
      AND code_reference = 'ddd6a931fc56f8dd92d953da5782e2e7cf77d5f0'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
