-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.43';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c91f8448645f30c9375867b312e01275b2aca5ec'
      OR v_existing.manifest_hash IS DISTINCT FROM '84cdd7a2755d398709147dec768ad454f3177053cc5eecf6ff99bf0f59240e8e'
      OR v_existing.source_tree IS DISTINCT FROM '76dd600e3e5c597e5b6840d30dd2b793cb1d7b27'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:301ec43ec4de06f0dd0a05b00ed609de9724c92413f688cfde2565e8dfc78569'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:8d00fd3011b00ca94cda69a09528a4408f49093cc5315ba9bc39c7ee5f316222'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.43","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.43/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260913200500'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.43"}'::jsonb
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
      '1.2.43',
      'published',
      '## 1.2.43

- Label account suggestions as possible matches and explain the existing staff-verification path when automatic identity checks do not match. Keep connection permissions and evidence requirements unchanged.
- Clarify when joining creates a record or needs staff review, label the public entry Open My CSF, and respect reduced-motion preferences in the join panel.
',
      'c91f8448645f30c9375867b312e01275b2aca5ec',
      '84cdd7a2755d398709147dec768ad454f3177053cc5eecf6ff99bf0f59240e8e',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '76dd600e3e5c597e5b6840d30dd2b793cb1d7b27',
      'sha256:301ec43ec4de06f0dd0a05b00ed609de9724c92413f688cfde2565e8dfc78569',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:8d00fd3011b00ca94cda69a09528a4408f49093cc5315ba9bc39c7ee5f316222',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.43","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.43/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260913200500',
      '{"minimum":"1.1.0","maximum":"1.2.43"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.43',
      code_reference = 'c91f8448645f30c9375867b312e01275b2aca5ec',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.42'
    AND code_reference = 'ca9d01f10547825ffd88278196cf49267586a73e';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.43'
      AND code_reference = 'c91f8448645f30c9375867b312e01275b2aca5ec'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
