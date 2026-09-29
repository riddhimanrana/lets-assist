-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.83';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '06afdd67ec9a6db6de84e17a7881faa9bc6b3591'
      OR v_existing.manifest_hash IS DISTINCT FROM '44f7ce3529f7f9bc1407a7d523b5545ca970b0afbf48c0fa45974453cbfd64b9'
      OR v_existing.source_tree IS DISTINCT FROM '0976c847953da0d31fb3f5c6b1bd730c5af3aa87'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:44fe064ed28e30163ea0144ff379bfc6a92d706e90fecd83eff5809906617db8'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:c97ee95d17c2cbf130eed7e815c0b26f17a4823e205e3dc94e5da4b62b71779e'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.83","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.83/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260928025013'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.83"}'::jsonb
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
      '1.2.83',
      'published',
      '## 1.2.83

Account requests show suggested students with a direct Connect account button. A single suggestion is selected in Review, with search and another-record selection available when needed. Recorded student name confirmations appear as context. Staff confirms ownership without writing a reason; the server retains the confirmation in the audit and rechecks account, class, and permission conflicts.
',
      '06afdd67ec9a6db6de84e17a7881faa9bc6b3591',
      '44f7ce3529f7f9bc1407a7d523b5545ca970b0afbf48c0fa45974453cbfd64b9',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '0976c847953da0d31fb3f5c6b1bd730c5af3aa87',
      'sha256:44fe064ed28e30163ea0144ff379bfc6a92d706e90fecd83eff5809906617db8',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:c97ee95d17c2cbf130eed7e815c0b26f17a4823e205e3dc94e5da4b62b71779e',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.83","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.83/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260928025013',
      '{"minimum":"1.1.0","maximum":"1.2.83"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.83',
      code_reference = '06afdd67ec9a6db6de84e17a7881faa9bc6b3591',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.82'
    AND code_reference = 'f35e6b5a4b5be8036f9a8ff13175f8a978efc96f';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.83'
      AND code_reference = '06afdd67ec9a6db6de84e17a7881faa9bc6b3591'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
