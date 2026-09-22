-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.68';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'ed7dc8fdbb7d1b5b07d5f3dbd482f4fc7eb88e17'
      OR v_existing.manifest_hash IS DISTINCT FROM '0cf064f0479ee565d613c74cadb037a18d6ea4f5900f14dceb0f2a3161fffbb0'
      OR v_existing.source_tree IS DISTINCT FROM '65077ad9b2968ce46dcfa99b1052fd2488b48f1f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:0e28ddcfe77ae98bd32992a54f6e72cdf65e1496883c6002d567cc626896ddcf'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:249b0253d86fc287b5291bbf9e99ff90feedbb8823b324aa3a512da768417502'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.68","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.68/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.68"}'::jsonb
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
      '1.2.68',
      'published',
      '## 1.2.68

The month calendar includes dated published activities that a connected student can already read in the class feed, including while semester decisions are pending. Ongoing activities appear throughout their saved date range, including when they began in an earlier month. Class restrictions, month boundaries and private deadline permissions remain enforced on the server.

Dashboard reads recover once from transient database transport failures. The existing retry classifier still stops on authorization failures and cancellation. Writes and notification dispatch are unchanged.
',
      'ed7dc8fdbb7d1b5b07d5f3dbd482f4fc7eb88e17',
      '0cf064f0479ee565d613c74cadb037a18d6ea4f5900f14dceb0f2a3161fffbb0',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '65077ad9b2968ce46dcfa99b1052fd2488b48f1f',
      'sha256:0e28ddcfe77ae98bd32992a54f6e72cdf65e1496883c6002d567cc626896ddcf',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:249b0253d86fc287b5291bbf9e99ff90feedbb8823b324aa3a512da768417502',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.68","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.68/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.68"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.68',
      code_reference = 'ed7dc8fdbb7d1b5b07d5f3dbd482f4fc7eb88e17',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.67'
    AND code_reference = 'eb1f2a3680e7f4a0c7889dfdb190efeccd051c91';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.68'
      AND code_reference = 'ed7dc8fdbb7d1b5b07d5f3dbd482f4fc7eb88e17'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
