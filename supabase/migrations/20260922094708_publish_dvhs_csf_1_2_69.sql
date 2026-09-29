-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.69';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'cb84734f1ebde5671ff37a9f3c480071b55da2c8'
      OR v_existing.manifest_hash IS DISTINCT FROM '28cf09deaf1b302fbc42cd470ed75733f90eff291f0ef3d2ced46624cc776a46'
      OR v_existing.source_tree IS DISTINCT FROM 'bda3caa59bf2aa93cb4ff840a9b966017a59cd32'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4c8f29fb9b1a0dd16158beae6f3b3d1691ddd24688c6a01df1fc2a84ec10a0ed'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:aa6d69fa2fa6aa6ef8497c10324ea64d4f81c0a85b9cc23eeea08debe62c6fd5'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.69","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.69/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.69"}'::jsonb
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
      '1.2.69',
      'published',
      '## 1.2.69

Member Feed activity cards show the title, date and time, location, and points. Descriptions remain on the activity detail page.

The officer import queue names the worksheet tab and explains which rows need a profile match, conflict resolution, duplicate review, or source correction. Counts still come from current persisted readiness and exclude already-recorded duplicates.
',
      'cb84734f1ebde5671ff37a9f3c480071b55da2c8',
      '28cf09deaf1b302fbc42cd470ed75733f90eff291f0ef3d2ced46624cc776a46',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'bda3caa59bf2aa93cb4ff840a9b966017a59cd32',
      'sha256:4c8f29fb9b1a0dd16158beae6f3b3d1691ddd24688c6a01df1fc2a84ec10a0ed',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:aa6d69fa2fa6aa6ef8497c10324ea64d4f81c0a85b9cc23eeea08debe62c6fd5',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.69","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.69/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.69"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.69',
      code_reference = 'cb84734f1ebde5671ff37a9f3c480071b55da2c8',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.68'
    AND code_reference = 'ed7dc8fdbb7d1b5b07d5f3dbd482f4fc7eb88e17';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.69'
      AND code_reference = 'cb84734f1ebde5671ff37a9f3c480071b55da2c8'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
