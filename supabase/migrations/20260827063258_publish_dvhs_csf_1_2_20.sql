-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.20';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1ba16c899076961dcb165025cff29b7a3900cc8b'
      OR v_existing.manifest_hash IS DISTINCT FROM 'cc8575e90deecbdc171f8918da44b266cbd2c4dab64075d1970add1289e96c91'
      OR v_existing.source_tree IS DISTINCT FROM 'e2c9e20ef6652244d916eb25601f4ec0f392f817'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:eb8c963b49efbbc863bc594e50f0a4975897c3290afafde48877bd6d77a13c57'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:14baad04b72c75b48420ff6a3b0613b81e3704676734631992ec53e14fd0da4b'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:48528bce816eee7fc232b20ccea075a866f430659c1c40b6887c3ea563b23b62'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.20","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.20/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260827020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.20"}'::jsonb
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
      '1.2.20',
      'published',
      '## 1.2.20 - 2026-08-26

- Continue the bounded imported-profile cleanup when the database rejects a
  previewed pair as conflicting, while still surfacing unrelated failures.
',
      '1ba16c899076961dcb165025cff29b7a3900cc8b',
      'cc8575e90deecbdc171f8918da44b266cbd2c4dab64075d1970add1289e96c91',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'e2c9e20ef6652244d916eb25601f4ec0f392f817',
      'sha256:eb8c963b49efbbc863bc594e50f0a4975897c3290afafde48877bd6d77a13c57',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:14baad04b72c75b48420ff6a3b0613b81e3704676734631992ec53e14fd0da4b',
      'sha256:48528bce816eee7fc232b20ccea075a866f430659c1c40b6887c3ea563b23b62',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.20","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.20/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260827020000',
      '{"minimum":"1.1.0","maximum":"1.2.20"}'::jsonb,
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
