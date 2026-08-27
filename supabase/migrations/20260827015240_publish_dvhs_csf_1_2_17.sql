-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.17';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '50fd7409ab79596ed8d5bdc27cb8821fbc69e8ae'
      OR v_existing.manifest_hash IS DISTINCT FROM 'add301099c70b863de507720a3dac9bde0ddfb2d3e12551222d653390c02f603'
      OR v_existing.source_tree IS DISTINCT FROM '1c0ad4a71860c9f2839f4f52c6631fcd08ba937f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:2069ac5b1f1f084ea66714aeebd78a6a0eb19fcd536ef868efc85dc54fc84eb7'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:467b4b921c1bed832e5d30682426305c30600c5b23215a6362f1bfc59a202f46'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:f28c8f21a2ecf0d1d0fbe09a14ea269386e8e9ed1184a6f9774fc5c9c0a2b2d1'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.17","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.17/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.17"}'::jsonb
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
      '1.2.17',
      'published',
      '## 1.2.17 - 2026-08-26

- Keep an earlier class-import row as valid same-workbook profile evidence after
  a newer preview supersedes that row. The exact workbook and immutable preview
  identity checks still apply.
',
      '50fd7409ab79596ed8d5bdc27cb8821fbc69e8ae',
      'add301099c70b863de507720a3dac9bde0ddfb2d3e12551222d653390c02f603',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '1c0ad4a71860c9f2839f4f52c6631fcd08ba937f',
      'sha256:2069ac5b1f1f084ea66714aeebd78a6a0eb19fcd536ef868efc85dc54fc84eb7',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:467b4b921c1bed832e5d30682426305c30600c5b23215a6362f1bfc59a202f46',
      'sha256:f28c8f21a2ecf0d1d0fbe09a14ea269386e8e9ed1184a6f9774fc5c9c0a2b2d1',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.17","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.17/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.17"}'::jsonb,
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
