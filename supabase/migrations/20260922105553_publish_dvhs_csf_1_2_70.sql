-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.70';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '6ffd1da307220ab60e2cf1c12e31321ff2fdfa59'
      OR v_existing.manifest_hash IS DISTINCT FROM '993183b513094fde27f58eee8e7200bde5ddd4307b83ea00d455a25894b950ea'
      OR v_existing.source_tree IS DISTINCT FROM 'ca3da578c28264c7fff2ffea0a5c9b5aed940c34'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:dc84bb2cc181c953154fd86b8b3ce740526b0f150a8d27dfb9bb7399c8f441cc'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:2a87855ee9b8095a3698d68cf2950c4a3a44e400ff702f0e6d5af233b32ba91e'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.70","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.70/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.70"}'::jsonb
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
      '1.2.70',
      'published',
      '## 1.2.70

The officer application queue loads courses, files, and corrections in the same paged read as its application records. This removes a second pass through the term while preserving complete evidence, stable queue ordering, and both officer access checks.
',
      '6ffd1da307220ab60e2cf1c12e31321ff2fdfa59',
      '993183b513094fde27f58eee8e7200bde5ddd4307b83ea00d455a25894b950ea',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'ca3da578c28264c7fff2ffea0a5c9b5aed940c34',
      'sha256:dc84bb2cc181c953154fd86b8b3ce740526b0f150a8d27dfb9bb7399c8f441cc',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:2a87855ee9b8095a3698d68cf2950c4a3a44e400ff702f0e6d5af233b32ba91e',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.70","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.70/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.70"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.70',
      code_reference = '6ffd1da307220ab60e2cf1c12e31321ff2fdfa59',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.69'
    AND code_reference = 'cb84734f1ebde5671ff37a9f3c480071b55da2c8';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.70'
      AND code_reference = '6ffd1da307220ab60e2cf1c12e31321ff2fdfa59'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
