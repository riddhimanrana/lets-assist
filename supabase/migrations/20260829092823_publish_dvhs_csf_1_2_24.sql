-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.24';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'cd1afd1734234bd8c287990179795370374d2939'
      OR v_existing.manifest_hash IS DISTINCT FROM '63e6f76dc7debb9fd7b52d4f55849860eb61da39c72c256a8deede8f871544d4'
      OR v_existing.source_tree IS DISTINCT FROM '019a6604a53dea64ebd8cae39eb14a4086f2e1ed'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:d4bf8f0ac15fe96693829222d3c77dc8b04f34f6e6fa946673ba2f7189c4b585'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:6f8bff0875f20b90ec5891351c33f177443e254a051bbc123e8a93e99a052458'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:b2db69f0b652069113346dba85560deda727ea3afb115e3ad39dc6834f0ecc8c'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.24","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.24/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260829020011'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.24"}'::jsonb
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
      '1.2.24',
      'published',
      '## 1.2.24 - 2026-08-29

- Replace the fixed member welcome card with versioned member and officer
  workspace tours, anchored to the controls each role can actually access.
- Save tour completion per organization and role, and allow either role to
  replay its tour from Help.
- Show pending student-record checks, keep name-only matches in officer review,
  and replace the review queue''s browser prompt with an inline reason dialog.
- Advance application and point review queues only after the server confirms a
  decision, with locked navigation and clear unknown-outcome guidance.
',
      'cd1afd1734234bd8c287990179795370374d2939',
      '63e6f76dc7debb9fd7b52d4f55849860eb61da39c72c256a8deede8f871544d4',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '019a6604a53dea64ebd8cae39eb14a4086f2e1ed',
      'sha256:d4bf8f0ac15fe96693829222d3c77dc8b04f34f6e6fa946673ba2f7189c4b585',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:6f8bff0875f20b90ec5891351c33f177443e254a051bbc123e8a93e99a052458',
      'sha256:b2db69f0b652069113346dba85560deda727ea3afb115e3ad39dc6834f0ecc8c',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.24","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.24/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260829020011',
      '{"minimum":"1.1.0","maximum":"1.2.24"}'::jsonb,
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
