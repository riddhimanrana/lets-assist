-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.14';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'e41b2db8d67106465dd48fd67892199acc0f36a3'
      OR v_existing.manifest_hash IS DISTINCT FROM '045adc55b261c6a9ffedb33ca13a015ebb859e820b1b7c54fba188a78395b431'
      OR v_existing.source_tree IS DISTINCT FROM '76d9e12491dacad69eb321f6e6120626217b96b4'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:2dee678233ed5162323cc5964afd31e5ff100060356737d2f20a5645d51703d9'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:79adc8ed0cb01aa460291dd0c934d8e305f574920b8f7c950cece57c74c28a62'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:712194a6cfc1faa55a4335b065b406dad2e598e9066c6b74bc967391e3853dc8'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.14","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.14/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.14"}'::jsonb
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
      '1.2.14',
      'published',
      '## 1.2.14 - 2026-08-25

- Match Drive comments across every selected import tab before attaching them
  to a row. Quotes that identify more than one cell remain unattached and appear
  in preview as comments that need manual placement.
',
      'e41b2db8d67106465dd48fd67892199acc0f36a3',
      '045adc55b261c6a9ffedb33ca13a015ebb859e820b1b7c54fba188a78395b431',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '76d9e12491dacad69eb321f6e6120626217b96b4',
      'sha256:2dee678233ed5162323cc5964afd31e5ff100060356737d2f20a5645d51703d9',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:79adc8ed0cb01aa460291dd0c934d8e305f574920b8f7c950cece57c74c28a62',
      'sha256:712194a6cfc1faa55a4335b065b406dad2e598e9066c6b74bc967391e3853dc8',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.14","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.14/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.14"}'::jsonb,
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
