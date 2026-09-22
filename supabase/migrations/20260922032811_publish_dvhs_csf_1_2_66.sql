-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.66';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '8e3da2fadb7024c4ecb9478ffb1354d93f98fa20'
      OR v_existing.manifest_hash IS DISTINCT FROM '5f64ae5c4e910b02e40e34c44b8612a5019305133c5bdb33e1e28fcd9d370e74'
      OR v_existing.source_tree IS DISTINCT FROM '3adebd9cad843d913ef852f364698671b3c429ef'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:17ed14eb28740ccda5d5875dbe8bcea3351eb22dcf8475ca5774b3540f856b3d'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:e73b7b114bf4a427c6be73581573c93835ae76d4ff88e8f65cdbe00d36de913c'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.66","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.66/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922030507'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.66"}'::jsonb
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
      '1.2.66',
      'published',
      '## 1.2.66

Officers can review ownership of an existing account link without unlinking the student. The review preserves profile history, imported contacts, and the original connection, records staff approval, and queues one account notice. The confirmation form retains its verification reason while checking identity and retrying.
',
      '8e3da2fadb7024c4ecb9478ffb1354d93f98fa20',
      '5f64ae5c4e910b02e40e34c44b8612a5019305133c5bdb33e1e28fcd9d370e74',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '3adebd9cad843d913ef852f364698671b3c429ef',
      'sha256:17ed14eb28740ccda5d5875dbe8bcea3351eb22dcf8475ca5774b3540f856b3d',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:e73b7b114bf4a427c6be73581573c93835ae76d4ff88e8f65cdbe00d36de913c',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.66","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.66/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922030507',
      '{"minimum":"1.1.0","maximum":"1.2.66"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.66',
      code_reference = '8e3da2fadb7024c4ecb9478ffb1354d93f98fa20',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.65'
    AND code_reference = '1fbb63306dca2d124b7796bfb8731af9a91d109f';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.66'
      AND code_reference = '8e3da2fadb7024c4ecb9478ffb1354d93f98fa20'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
