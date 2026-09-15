-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.49';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'deb220b48422507f6a406c0911433577a0c08391'
      OR v_existing.manifest_hash IS DISTINCT FROM '4dc5c34649c5c33345ac8e4fc56ffccccfb85e9df863312749bad34190823c30'
      OR v_existing.source_tree IS DISTINCT FROM 'c917d9b6792d283fc86f0cac4078b96d6114eece'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:eb5f461e4699f2e8ca9e60768b54ba9ecaaa2589033a5c82a7e234955b8650c4'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:3b174591e4519626819fe56ff4ca264ffdb546583ecd1d8f26c0818b8d40ee8f'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.49","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.49/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260915161000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.49"}'::jsonb
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
      '1.2.49',
      'published',
      '## 1.2.49

- Keep account reviews tied to the selected request and search within its class. Preserve pending identity restrictions when students retry joining.
- Show staff account names and source Sheet links for historical semesters.
- Explain missing point-submission inputs, preserve review filters, and show the latest invitation action result.
- Require the reviewed import-history and activity-cap database protections.
- Close the activity publication confirmation after the server confirms success. Show server errors in the dialog and prevent repeated submissions while publication is pending.
',
      'deb220b48422507f6a406c0911433577a0c08391',
      '4dc5c34649c5c33345ac8e4fc56ffccccfb85e9df863312749bad34190823c30',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c917d9b6792d283fc86f0cac4078b96d6114eece',
      'sha256:eb5f461e4699f2e8ca9e60768b54ba9ecaaa2589033a5c82a7e234955b8650c4',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:3b174591e4519626819fe56ff4ca264ffdb546583ecd1d8f26c0818b8d40ee8f',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.49","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.49/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260915161000',
      '{"minimum":"1.1.0","maximum":"1.2.49"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.49',
      code_reference = 'deb220b48422507f6a406c0911433577a0c08391',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.48'
    AND code_reference = 'd0d19e3bf451f83debe6524e916cbbb14991c4fd';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.49'
      AND code_reference = 'deb220b48422507f6a406c0911433577a0c08391'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
