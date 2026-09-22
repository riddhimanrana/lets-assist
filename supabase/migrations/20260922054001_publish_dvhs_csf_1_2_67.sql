-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.67';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'eb1f2a3680e7f4a0c7889dfdb190efeccd051c91'
      OR v_existing.manifest_hash IS DISTINCT FROM '03450bb005d019e8c0dea6bfc0df5a541fa43e821e5d5caa5d4704812809e3d5'
      OR v_existing.source_tree IS DISTINCT FROM 'c88377870d59e52e02e5ccae0ac429c1ef887f7e'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:e626680c2d7827dd513709aab61fef3c17281ea921a10d82bffe558534296152'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:1509f2bfc3e29d68ec4f5024d5c49694a45cf2bd89523075132eba88eb408f95'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.67","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.67/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.67"}'::jsonb
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
      '1.2.67',
      'published',
      '## 1.2.67

Applications load independent review reads together and fetch verified credit totals in bounded batches. Chapter, semester and profile filters remain enforced on the server, and the workspace rechecks officer access before returning evidence.
',
      'eb1f2a3680e7f4a0c7889dfdb190efeccd051c91',
      '03450bb005d019e8c0dea6bfc0df5a541fa43e821e5d5caa5d4704812809e3d5',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c88377870d59e52e02e5ccae0ac429c1ef887f7e',
      'sha256:e626680c2d7827dd513709aab61fef3c17281ea921a10d82bffe558534296152',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:1509f2bfc3e29d68ec4f5024d5c49694a45cf2bd89523075132eba88eb408f95',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.67","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.67/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.67"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.67',
      code_reference = 'eb1f2a3680e7f4a0c7889dfdb190efeccd051c91',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.66'
    AND code_reference = '8e3da2fadb7024c4ecb9478ffb1354d93f98fa20';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.67'
      AND code_reference = 'eb1f2a3680e7f4a0c7889dfdb190efeccd051c91'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
