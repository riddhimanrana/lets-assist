-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.65';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1fbb63306dca2d124b7796bfb8731af9a91d109f'
      OR v_existing.manifest_hash IS DISTINCT FROM 'ceb967b42f54c7d5b6b11b0c26df8be1d94541c0175c8399110b70e08da85575'
      OR v_existing.source_tree IS DISTINCT FROM 'e7c79c9af66a82597a227bcad1219b1c7c6284e8'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:16ede2a6b401ce4be97bbbe124e2c8236221af4d9f3042ea0e73c7c34ece6880'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:1763b5b56541e06ae7b31a6d1e3987c8a395f006e2a07f307ac5cc56d0110722'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.65","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.65/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.65"}'::jsonb
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
      '1.2.65',
      'published',
      '## 1.2.65

Partial attendance imports recheck the source when officers resolve more rows. Settled retries reuse the existing receipt.

Attendance import now asks officers to review and skip cutoff responses before importing verified rows, matching the database gate.

Attendance reconciliation now includes the CSF record identifier in every candidate label. Officers can distinguish students with the same name even when neither has an account or school email.
',
      '1fbb63306dca2d124b7796bfb8731af9a91d109f',
      'ceb967b42f54c7d5b6b11b0c26df8be1d94541c0175c8399110b70e08da85575',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'e7c79c9af66a82597a227bcad1219b1c7c6284e8',
      'sha256:16ede2a6b401ce4be97bbbe124e2c8236221af4d9f3042ea0e73c7c34ece6880',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:1763b5b56541e06ae7b31a6d1e3987c8a395f006e2a07f307ac5cc56d0110722',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.65","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.65/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.65"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.65',
      code_reference = '1fbb63306dca2d124b7796bfb8731af9a91d109f',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.63'
    AND code_reference = 'd57107a9efafe51abed7f07c25cec48c7b65cf03';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.65'
      AND code_reference = '1fbb63306dca2d124b7796bfb8731af9a91d109f'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
