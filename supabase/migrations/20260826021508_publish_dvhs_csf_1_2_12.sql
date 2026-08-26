-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.12';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'ffccbff2d97c7bf3542efdae61730d8631f838f0'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd66d76c5e952d1d302301ab05b463ce030bca2608ad579bae4e7fac9b6580946'
      OR v_existing.source_tree IS DISTINCT FROM 'd208d13fc717fe26ee24d8108d5b65864f09f13e'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:d2b4a1e122080a2ee8d19974ef4f63b76ed63561a12efcfad360fb6a61416fc0'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:03280e449ed9a6d922c7def0e35f2e05cce23b9651f6b6df51d12cd1ef46e41b'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:185397bf62c45958bd38728be0a4605a2b452b5fccb7d4a5f3db2999bf0e51e7'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.12","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.12/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.12"}'::jsonb
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
      '1.2.12',
      'published',
      '## 1.2.12 - 2026-08-25

- Made historical class imports discover every semester tab and preserve
  activity names, meeting labels, source comments, point values, and source
  coordinates through preview and commit.
- Added deterministic email-aware profile matching, explicit unresolved-row
  review, imported-profile creation, and safe class-sheet relinking without
  name-only account merges.
- Reduced import preview work to one validated workbook parse and one readiness
  query, bounded large diagnostics, and blocked stale analysis results from
  replacing the current file selection.
- Added partner-club response interpretation and policy review while keeping
  spreadsheet writes and consequential decisions officer-controlled.
- Simplified class-code onboarding, profile term history, point submission,
  and Google Sheet selection around the same durable source records.
',
      'ffccbff2d97c7bf3542efdae61730d8631f838f0',
      'd66d76c5e952d1d302301ab05b463ce030bca2608ad579bae4e7fac9b6580946',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'd208d13fc717fe26ee24d8108d5b65864f09f13e',
      'sha256:d2b4a1e122080a2ee8d19974ef4f63b76ed63561a12efcfad360fb6a61416fc0',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:03280e449ed9a6d922c7def0e35f2e05cce23b9651f6b6df51d12cd1ef46e41b',
      'sha256:185397bf62c45958bd38728be0a4605a2b452b5fccb7d4a5f3db2999bf0e51e7',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.12","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.12/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.12"}'::jsonb,
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
