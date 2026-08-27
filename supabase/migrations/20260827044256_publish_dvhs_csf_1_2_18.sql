-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.18';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '9a7ce593ceb77e0a8b918bd9964ebd35c79db5c2'
      OR v_existing.manifest_hash IS DISTINCT FROM '0fea18e134421de6f28baa2b69fab444a5988e88a38265973826a25858abfa1c'
      OR v_existing.source_tree IS DISTINCT FROM 'cbec691fc742625418acf2b5a7a954082a1122e7'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4801f58590d92351a868f194cd4590a161a674811a10ab821466406585cc044c'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:7bae7915242aced4750c92c4d97ad41959d735331972d60f93df7090b68d1065'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:337871c540738cadbfa87c01713f61212f359fe4179df644b496afdc05f7b739'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.18","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.18/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.18"}'::jsonb
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
      '1.2.18',
      'published',
      '## 1.2.18 - 2026-08-26

- Reuse the oldest no-contact profile when exact same-workbook identity evidence comes from distinct semester tabs.
- Keep same-tab duplicates and profiles with canonical contact data in officer review.
',
      '9a7ce593ceb77e0a8b918bd9964ebd35c79db5c2',
      '0fea18e134421de6f28baa2b69fab444a5988e88a38265973826a25858abfa1c',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'cbec691fc742625418acf2b5a7a954082a1122e7',
      'sha256:4801f58590d92351a868f194cd4590a161a674811a10ab821466406585cc044c',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:7bae7915242aced4750c92c4d97ad41959d735331972d60f93df7090b68d1065',
      'sha256:337871c540738cadbfa87c01713f61212f359fe4179df644b496afdc05f7b739',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.18","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.18/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.18"}'::jsonb,
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
