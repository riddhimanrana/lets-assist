-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.2';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '56a36530d1cf95a1249ff51079674851ff73775e'
      OR v_existing.manifest_hash IS DISTINCT FROM '79633d822b73ffecb8e5cd5c91e8e7364955023033915c99988c1c22556ef9be'
      OR v_existing.source_tree IS DISTINCT FROM '7faa58e98ea33ee6573e0032c095914d0abbedca'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:695a5956d53b4c64934a56063bea71450935f79b18e79ecac894daebd6b94437'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:209639be57d3b61936a07867fe95d1ad038c693436e0b8c3395f31ad02ce572e'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:8fc20936e17d7232e6079539a58de9527e1f32ad2bececb0874de6857a7df0bb'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.2","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.2/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260820130000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.2"}'::jsonb
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
      '1.2.2',
      'published',
      '## 1.2.2 - 2026-08-21

- Signed separate Vercel prebuilt artifacts for Development and Production.
- Bound each deployment to the artifact built with that environment''s variables.
',
      '56a36530d1cf95a1249ff51079674851ff73775e',
      '79633d822b73ffecb8e5cd5c91e8e7364955023033915c99988c1c22556ef9be',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '7faa58e98ea33ee6573e0032c095914d0abbedca',
      'sha256:695a5956d53b4c64934a56063bea71450935f79b18e79ecac894daebd6b94437',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:209639be57d3b61936a07867fe95d1ad038c693436e0b8c3395f31ad02ce572e',
      'sha256:8fc20936e17d7232e6079539a58de9527e1f32ad2bececb0874de6857a7df0bb',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.2","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.2/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260820130000',
      '{"minimum":"1.1.0","maximum":"1.2.2"}'::jsonb,
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
