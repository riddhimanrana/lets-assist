-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.75';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'ed9eb5b3ed5fd4d69162d55cc20477323247e94c'
      OR v_existing.manifest_hash IS DISTINCT FROM 'fd42f9fca36935a43a661fe718c1f0934ea25badf0b64d026edca23b80034f30'
      OR v_existing.source_tree IS DISTINCT FROM '6ad2e3c6f02ea9d95f3ba7f41d348e0514292e65'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:9d2b78fc001ac40071a41f30dd1b8c158cf6f0659af8045bbed28020d3c4acf9'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:eb12df03bc656df76c44c97348e030f6506a5b43931baaed9014cf8757a5d546'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.75","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.75/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260923011212'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.75"}'::jsonb
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
      '1.2.75',
      'published',
      '## 1.2.75

Point submissions use class, semester and status filters with bounded paging. Officers review a submission and all its proofs in one dialog, keeping their place after a save or close. Authorized officers can lock or reopen submissions through the existing semester verification controls.

Class-import links open the correct class and semester. Matched preview rows remain available for review and exclusion before importing, and failed rows retain their audited recovery controls.

Google Calendar authorization starts only when Connect or Reconnect is clicked, using a full-page browser navigation.
',
      'ed9eb5b3ed5fd4d69162d55cc20477323247e94c',
      'fd42f9fca36935a43a661fe718c1f0934ea25badf0b64d026edca23b80034f30',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '6ad2e3c6f02ea9d95f3ba7f41d348e0514292e65',
      'sha256:9d2b78fc001ac40071a41f30dd1b8c158cf6f0659af8045bbed28020d3c4acf9',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:eb12df03bc656df76c44c97348e030f6506a5b43931baaed9014cf8757a5d546',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.75","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.75/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260923011212',
      '{"minimum":"1.1.0","maximum":"1.2.75"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.75',
      code_reference = 'ed9eb5b3ed5fd4d69162d55cc20477323247e94c',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.74'
    AND code_reference = 'f6ca8e2097f64381499d5a79c1bdfdce5e282d7a';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.75'
      AND code_reference = 'ed9eb5b3ed5fd4d69162d55cc20477323247e94c'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
