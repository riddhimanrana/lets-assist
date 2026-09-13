-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.38';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '3fbabfba4fb275a38c13d18558de94f15f1213cd'
      OR v_existing.manifest_hash IS DISTINCT FROM 'f6b7726ff1dba5d1709ba7f33bafc7ebecfa53063ca4ab456633dd3bd8b4c8fe'
      OR v_existing.source_tree IS DISTINCT FROM '1a27e7103dd19861698011fc14e779af4787deb0'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:f2efc6b78d8f2b7f97e07ba680edfc189b1e09e17d926c9c3a3851513d848196'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:41868fe90f22c11c9dc79d57f64c778f3765ae12bb13b9434632dc55cd6efb59'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.38","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.38/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260912015608'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.38"}'::jsonb
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
      '1.2.38',
      'published',
      '## 1.2.38

- Recover confirmed exports with comments disabled without submitting a Comments-column receipt. Preserve empty receipts for actual Comments-column exports.
- Show saved posts on officer Home for administrators and staff with post-management access, including officer-only announcements. Reuse the existing edit, archive, pin and reply controls without requiring a linked member profile.
- Label the point-correction amount "Points" to match Point submissions.
- Keep activity details after validation errors, show the result, and close the form after a confirmed save. Treat interrupted saves as retry-safe and require a reload when the outcome is unknown.
',
      '3fbabfba4fb275a38c13d18558de94f15f1213cd',
      'f6b7726ff1dba5d1709ba7f33bafc7ebecfa53063ca4ab456633dd3bd8b4c8fe',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '1a27e7103dd19861698011fc14e779af4787deb0',
      'sha256:f2efc6b78d8f2b7f97e07ba680edfc189b1e09e17d926c9c3a3851513d848196',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:41868fe90f22c11c9dc79d57f64c778f3765ae12bb13b9434632dc55cd6efb59',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.38","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.38/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260912015608',
      '{"minimum":"1.1.0","maximum":"1.2.38"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.38',
      code_reference = '3fbabfba4fb275a38c13d18558de94f15f1213cd',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.37'
    AND code_reference = '18427766939ab0248d4597eaf00f17f51fe1242e';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.38'
      AND code_reference = '3fbabfba4fb275a38c13d18558de94f15f1213cd'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
