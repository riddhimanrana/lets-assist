-- Harden the append-only Development reconciliation with the complete signed
-- DVHS CSF 1.2.1 identity. The earlier ledger rows remain byte-stable.

BEGIN;

CREATE OR REPLACE FUNCTION private.assert_dvhs_csf_1_2_1_release_identity()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions
    WHERE plugin_key = 'dvhs-csf'
      AND version = '1.2.1'
      AND status = 'published'
      AND changelog = '## 1.2.1 - 2026-08-20

- Packaged every Vercel function trace input so the signed application build can deploy on a separate runner.
- Kept archive paths and symlinks confined to the reviewed prebuilt application roots.
'
      AND commit_sha = '37d0dbd414a64bf53076fe30450b38b1e90a4ec9'
      AND manifest_hash = '3b510417bf5e8d8512cbe9f74a5cd3cd0faf894b9a1c8325001c2dbb7d2de3cb'
      AND compatibility_contract = '{"host":"lets-assist","automaticUpdate":false}'::jsonb
      AND rollout_percentage = 0
      AND source_tree = 'afa6799615e1d0af2b14072fee26122c07ca37d6'
      AND content_digest = 'sha256:689a9c24c4d931c331a100911db2ce7fb20061102d2e3dd192c2185f40c91e0e'
      AND release_inputs = '["plugins/dvhs-csf","apps/csf"]'::jsonb
      AND build_digest = 'sha256:dee24c38f33f33de934eeb1815d2b07daeb78135fb4b4a13f3cf4855497de15b'
      AND sbom_digest = 'sha256:f315149d63f3c3a279e1ae0986d45acade45b0a3b2622be16ad54913f3a0a00c'
      AND signer_identity = '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.1","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.1/release-manifest.sigstore.json"}'::jsonb
      AND host_api_range = '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      AND plugin_data_schema_version = 1
      AND required_platform_schema_version = '20260820130000'
      AND supported_install_contracts = '{"minimum":"1.1.0","maximum":"1.2.1"}'::jsonb
      AND runtime_profile = 'application'
      AND published_by IS NULL
      AND published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Signed DVHS CSF 1.2.1 release identity is missing or divergent';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_dvhs_csf_1_2_1_release_identity()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assert_dvhs_csf_1_2_1_release_identity()
  TO postgres;

SELECT private.assert_dvhs_csf_1_2_1_release_identity();

COMMIT;
