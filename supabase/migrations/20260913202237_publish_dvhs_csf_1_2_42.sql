-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.42';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'ca9d01f10547825ffd88278196cf49267586a73e'
      OR v_existing.manifest_hash IS DISTINCT FROM '1bf5b0bbf665e7810e2aa49232da57fd6956a37f8d5084e50e4a964867e738b5'
      OR v_existing.source_tree IS DISTINCT FROM '47ccab218152f5576788fcfab76745f5c68f9d26'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:1f176a7dc7cd0f1f5a30622e41dccee84d776bc52b02f5eb48d35cf376aebd32'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:66ede26d945628ac4e4747e675dc6bd8de204381c15db8dfaf865aa1ba3eaaea'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.42","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.42/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260913200500'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.42"}'::jsonb
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
      '1.2.42',
      'published',
      '## 1.2.42

- Hide Sheet discussion controls when comments are disabled, and reject stale comment submissions before they can be saved.
',
      'ca9d01f10547825ffd88278196cf49267586a73e',
      '1bf5b0bbf665e7810e2aa49232da57fd6956a37f8d5084e50e4a964867e738b5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '47ccab218152f5576788fcfab76745f5c68f9d26',
      'sha256:1f176a7dc7cd0f1f5a30622e41dccee84d776bc52b02f5eb48d35cf376aebd32',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:66ede26d945628ac4e4747e675dc6bd8de204381c15db8dfaf865aa1ba3eaaea',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.42","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.42/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260913200500',
      '{"minimum":"1.1.0","maximum":"1.2.42"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.42',
      code_reference = 'ca9d01f10547825ffd88278196cf49267586a73e',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.41'
    AND code_reference = '74d7372fef09b22eb06fb31285607eb7d80e38d3';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.42'
      AND code_reference = 'ca9d01f10547825ffd88278196cf49267586a73e'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
