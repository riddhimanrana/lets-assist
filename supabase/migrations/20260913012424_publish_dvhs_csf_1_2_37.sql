-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.37';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '18427766939ab0248d4597eaf00f17f51fe1242e'
      OR v_existing.manifest_hash IS DISTINCT FROM 'df6300b1a21fd24de5ed6267399b22cbae4d5048817f881d745d0a6284a089c7'
      OR v_existing.source_tree IS DISTINCT FROM 'c532964f13b79791cfda924228081b698babdd68'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:35384fc8a65bd2831215884fda4ceb7b95b21459eeaa36fae5c154ca3fdcc5f3'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:779c7bb5b561bfc621a3ca7a722e8a85ba7ddd9f592f025f06c25bbd71d1f33a'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.37","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.37/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260912015608'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.37"}'::jsonb
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
      '1.2.37',
      'published',
      '## 1.2.37

- Default Sheet sync to the current semester and show its label. Require a choice when no current semester is available.
- Confirm completed Sheet exports when Google returns empty cells as blanks. Recover those writes from their saved attempt while preserving exact record and version checks.
- Show appeal history and authorized review controls for point submissions that already have a decision.
- Link Officers & access to the organization member directory beside the invitation control.
',
      '18427766939ab0248d4597eaf00f17f51fe1242e',
      'df6300b1a21fd24de5ed6267399b22cbae4d5048817f881d745d0a6284a089c7',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c532964f13b79791cfda924228081b698babdd68',
      'sha256:35384fc8a65bd2831215884fda4ceb7b95b21459eeaa36fae5c154ca3fdcc5f3',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:779c7bb5b561bfc621a3ca7a722e8a85ba7ddd9f592f025f06c25bbd71d1f33a',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.37","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.37/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260912015608',
      '{"minimum":"1.1.0","maximum":"1.2.37"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.37',
      code_reference = '18427766939ab0248d4597eaf00f17f51fe1242e',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.36'
    AND code_reference = '20141fb766409d3b9b493128a8cc6c4a6710a20d';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.37'
      AND code_reference = '18427766939ab0248d4597eaf00f17f51fe1242e'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
