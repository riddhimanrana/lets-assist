-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.79';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'e72e343e44d826747cc13443a6a64fa0b5c9da3e'
      OR v_existing.manifest_hash IS DISTINCT FROM '09f8e84e0bedc84b1ebf192fd13c50972d33d2d901dd6d3739cada529b23ad21'
      OR v_existing.source_tree IS DISTINCT FROM 'c6a9094659fb99f2420917c1c742650919ed3e8e'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:cf5032302ebe15e41af79367d25af0d8329d0a37f23ffeb1967f559fe96ed0b3'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:3320c9966537ad11485d4c0e831eb35022d9bca8ec71bbc85e5be6f7558857b0'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.79","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.79/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260924075152'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.79"}'::jsonb
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
      '1.2.79',
      'published',
      '## 1.2.79

Unsubmit permanently deletes an eligible member submission, its proof files, saved edits and submission history. The action reports success only after file cleanup completes. Late uploads cannot restore deleted proof. Final decisions and awarded credit still use the correction workflow.

Legacy withdrawn entries no longer appear in the member submission list or semester ledger.
',
      'e72e343e44d826747cc13443a6a64fa0b5c9da3e',
      '09f8e84e0bedc84b1ebf192fd13c50972d33d2d901dd6d3739cada529b23ad21',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c6a9094659fb99f2420917c1c742650919ed3e8e',
      'sha256:cf5032302ebe15e41af79367d25af0d8329d0a37f23ffeb1967f559fe96ed0b3',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:3320c9966537ad11485d4c0e831eb35022d9bca8ec71bbc85e5be6f7558857b0',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.79","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.79/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260924075152',
      '{"minimum":"1.1.0","maximum":"1.2.79"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.79',
      code_reference = 'e72e343e44d826747cc13443a6a64fa0b5c9da3e',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.78'
    AND code_reference = '8ecfcfdeb6b15be5ced3d452924d70206256f6e4';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.79'
      AND code_reference = 'e72e343e44d826747cc13443a6a64fa0b5c9da3e'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
