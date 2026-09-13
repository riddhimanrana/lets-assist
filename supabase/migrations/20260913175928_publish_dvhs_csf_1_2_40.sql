-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.40';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '925d5ca047d7c21f03ea74d258873372c0d4fd14'
      OR v_existing.manifest_hash IS DISTINCT FROM '65e39e1ea6f18694e24d77557ddab4846aee6154f6e338db3ac33fc3930dc03d'
      OR v_existing.source_tree IS DISTINCT FROM '088c3b48be0b4ffdaa8237aefafa489b26cf9d44'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f1c13215428a8f81ea3dc0cb602bdd2e6f49f31f9ac60a03795b4184320bbe02'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:56c4f5fb7ca9925458c48be1ecb21367e0773ff7e7e00f794ae79d4fe87506dd'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.40","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.40/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260913061610'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.40"}'::jsonb
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
      '1.2.40',
      'published',
      '## 1.2.40

- Label application totals as reported academic points and keep verified participation points separate. Show submissions awaiting a student correction separately from points under review.
- Clarify application correction acknowledgment and label review reason fields for accessible form use.
- Verify Sheet exports from the managed grid returned with the write, preserving record and version checks when a later read would fail. Keep uncertain writes held for reconciliation and explain why confirmation failed.
',
      '925d5ca047d7c21f03ea74d258873372c0d4fd14',
      '65e39e1ea6f18694e24d77557ddab4846aee6154f6e338db3ac33fc3930dc03d',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '088c3b48be0b4ffdaa8237aefafa489b26cf9d44',
      'sha256:f1c13215428a8f81ea3dc0cb602bdd2e6f49f31f9ac60a03795b4184320bbe02',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:56c4f5fb7ca9925458c48be1ecb21367e0773ff7e7e00f794ae79d4fe87506dd',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.40","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.40/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260913061610',
      '{"minimum":"1.1.0","maximum":"1.2.40"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.40',
      code_reference = '925d5ca047d7c21f03ea74d258873372c0d4fd14',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.39'
    AND code_reference = 'ddd6a931fc56f8dd92d953da5782e2e7cf77d5f0';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.40'
      AND code_reference = '925d5ca047d7c21f03ea74d258873372c0d4fd14'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
