-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.0';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'b1f4fa8e13856dc0c868b4bb952069d7507dfe6b'
      OR v_existing.manifest_hash IS DISTINCT FROM '3bbb852420cf02f2ac055b8f640e36c0e3d3c01f953382d10503d6a90b60e762'
      OR v_existing.source_tree IS DISTINCT FROM '688ce4a9deb04454dd43839569e3c3eb37f9294e'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f1e0703ed4216dfd30557ed321a408d8bc7b185dbbd7489b0d698630401ad00f'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:a24450fc6d0e8421e872fb7302c3f298d0c0b9ac88e2aefca14d6702e2cd396d'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:d73dda3df00af3ce3bbeefef06e48203905a1be1cc3027401496e42ab1ae3a32'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.0","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.0/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260820130000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.0"}'::jsonb
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
      '1.2.0',
      'published',
      '## 1.2.0 - 2026-08-20

- Added the independently built CSF application runtime and caller-scoped access proof.
- Added a signed Vercel prebuilt artifact contract for Development-first deployment and promotion.
- Kept version 1.1.0 installs compatible during the flagged application rollout.
',
      'b1f4fa8e13856dc0c868b4bb952069d7507dfe6b',
      '3bbb852420cf02f2ac055b8f640e36c0e3d3c01f953382d10503d6a90b60e762',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '688ce4a9deb04454dd43839569e3c3eb37f9294e',
      'sha256:f1e0703ed4216dfd30557ed321a408d8bc7b185dbbd7489b0d698630401ad00f',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:a24450fc6d0e8421e872fb7302c3f298d0c0b9ac88e2aefca14d6702e2cd396d',
      'sha256:d73dda3df00af3ce3bbeefef06e48203905a1be1cc3027401496e42ab1ae3a32',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.0","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.0/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260820130000',
      '{"minimum":"1.1.0","maximum":"1.2.0"}'::jsonb,
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
