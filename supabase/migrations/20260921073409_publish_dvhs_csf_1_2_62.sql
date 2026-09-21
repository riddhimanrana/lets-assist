-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.62';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '08ab00287bf34f8485338d4d35e9a30c5a9a6a54'
      OR v_existing.manifest_hash IS DISTINCT FROM '8e486f3ebfe8164d115c8c2708f1103c74a98dbc9addf9cbdad7ce953a31e2f5'
      OR v_existing.source_tree IS DISTINCT FROM '0ad20f052691155514855317c4664dafa4de9659'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:53805691e5a0e7ea32fc97b09d7c02e96bed871e86447fa5369075f96d6924ce'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:3004a897bed7280b752e9f2af90a2ab68633562cd7bfaea8f743f403fbec889e'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.62","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.62/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.62"}'::jsonb
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
      '1.2.62',
      'published',
      '## 1.2.62

- Match attendance to a unique full name in CSF records, including students without an account or saved email. Keep shared names and conflicting classes or contacts in review.
- Read attendance and roster records in batches, and separate existing attendance and cutoff exclusions from responses that need review.
',
      '08ab00287bf34f8485338d4d35e9a30c5a9a6a54',
      '8e486f3ebfe8164d115c8c2708f1103c74a98dbc9addf9cbdad7ce953a31e2f5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '0ad20f052691155514855317c4664dafa4de9659',
      'sha256:53805691e5a0e7ea32fc97b09d7c02e96bed871e86447fa5369075f96d6924ce',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:3004a897bed7280b752e9f2af90a2ab68633562cd7bfaea8f743f403fbec889e',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.62","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.62/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.62"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.62',
      code_reference = '08ab00287bf34f8485338d4d35e9a30c5a9a6a54',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.61'
    AND code_reference = '63de568899ed8f7f4dec7730fca05516bc0ea435';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.62'
      AND code_reference = '08ab00287bf34f8485338d4d35e9a30c5a9a6a54'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
