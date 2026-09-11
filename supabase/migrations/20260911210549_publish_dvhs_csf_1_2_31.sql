-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.31';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '6b73d0901fe58e5eada93026b085a9cc472566d7'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd75bf81b21a63e002fe5f488b95f37e8335f9dcc97ee713b046ab7edbeeaa9ae'
      OR v_existing.source_tree IS DISTINCT FROM '1600c5286d6e40df9eab65423fc0691d8b2f5211'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:0f397b76ca65f94b101eea678a81774653c8f530bedae7263f41238cb63b7374'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:fe0f244f066e1a9438895260d7f522c2f92e6dc6e45f557afdcde2e496462e81'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:fdab232c310f85f6f8e90c67a377dfe1200d98f0ea1a822a8effb7cda73608d7'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.31","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.31/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260911203901'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.31"}'::jsonb
      OR v_existing.runtime_profile IS DISTINCT FROM 'application'
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
      '1.2.31',
      'published',
      '## 1.2.31

- Preserve reviewed input observations when a later export fails. Only incomplete inbound reads invalidate pending Sheet changes.
',
      '6b73d0901fe58e5eada93026b085a9cc472566d7',
      'd75bf81b21a63e002fe5f488b95f37e8335f9dcc97ee713b046ab7edbeeaa9ae',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '1600c5286d6e40df9eab65423fc0691d8b2f5211',
      'sha256:0f397b76ca65f94b101eea678a81774653c8f530bedae7263f41238cb63b7374',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:fe0f244f066e1a9438895260d7f522c2f92e6dc6e45f557afdcde2e496462e81',
      'sha256:fdab232c310f85f6f8e90c67a377dfe1200d98f0ea1a822a8effb7cda73608d7',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.31","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.31/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260911203901',
      '{"minimum":"1.1.0","maximum":"1.2.31"}'::jsonb,
      'application',
      now()
    );
  END IF;

  PERFORM 1
  FROM public.plugins
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.1.0'
    AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
