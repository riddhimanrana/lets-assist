-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.28';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd94bcf2e1901abd36ed445718f20becac5c3060e'
      OR v_existing.manifest_hash IS DISTINCT FROM '7ced07bb6536536837a233c5db9bc9f26bec030cdf574e76ad1fb2ede94b675b'
      OR v_existing.source_tree IS DISTINCT FROM '3fe9179a18340419c1ba3ec31a9d50015282bea0'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:3ba5f7a1e4a4067cd555f7fc692037854858b6f09708079027b636112ab5b34e'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:007444612f31f46c6e548dcc0774d19c35b048b0a7576c876b9e188713afde76'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:ebd25d57ef2599b35df29fa7dddad50e82ccf1a0001058f9cd8bba1b75879a4d'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.28","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.28/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260911184253'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.28"}'::jsonb
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
      '1.2.28',
      'published',
      '## 1.2.28

New Sheet destinations export discussion history in a Comments column. Staff review Sheet edits before adding them to the local history. Existing native-thread destinations keep their format. Copied-workbook acceptance checks the column output and reviewed edits before live sync can be enabled.
',
      'd94bcf2e1901abd36ed445718f20becac5c3060e',
      '7ced07bb6536536837a233c5db9bc9f26bec030cdf574e76ad1fb2ede94b675b',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '3fe9179a18340419c1ba3ec31a9d50015282bea0',
      'sha256:3ba5f7a1e4a4067cd555f7fc692037854858b6f09708079027b636112ab5b34e',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:007444612f31f46c6e548dcc0774d19c35b048b0a7576c876b9e188713afde76',
      'sha256:ebd25d57ef2599b35df29fa7dddad50e82ccf1a0001058f9cd8bba1b75879a4d',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.28","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.28/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260911184253',
      '{"minimum":"1.1.0","maximum":"1.2.28"}'::jsonb,
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
