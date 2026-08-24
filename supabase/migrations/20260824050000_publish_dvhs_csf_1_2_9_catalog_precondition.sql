-- Re-assert the dvhs-csf 1.2.9 publication against the catalog as it actually is.
--
-- 20260824002008 carries the same signed release identity as this file. Its only
-- defect is the precondition: it asserts the catalog sits at
-- latest_version 1.1.0 / code_reference df7c59fd..., the value that was briefly
-- in published-releases.json while #268's repin was live. #270 reverted that
-- repin (a20d7aed), so 1.1.0's sourceCommit is 4d1001e9... again, and that is
-- what Production actually holds. The signed integration was generated inside
-- the repin window and froze the value that no longer exists anywhere.
--
-- The assertion is the whole difference. For an `application` runtime profile
-- the catalog block only PERFORMs a check; it never writes public.plugins. So
-- this file is 20260824002008 with the precondition corrected to the true
-- catalog state, and every signed value -- commit_sha, manifest_hash,
-- source_tree, content_digest, build and SBOM digests, signer identity, host
-- API range, install contracts -- copied verbatim. Nothing about the release
-- identity is re-derived here.
--
-- 20260824002008 is NOT edited. Any environment that applied it did so against
-- the catalog state it asserted, and rewriting a signed artifact would defeat
-- the point of signing it. Its INSERT branch is idempotent, so on such an
-- environment this file verifies the existing row and changes nothing.

-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.9';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '36f83b60a5f0a061997e3913a06cafed2a88e966'
      OR v_existing.manifest_hash IS DISTINCT FROM '6e5de7e0712cefb639fc669f5c481c07a5374dd3e00cf44f36ac7a03624432a6'
      OR v_existing.source_tree IS DISTINCT FROM 'fdf9e2c117e8303022c5ab89bea2cb7fd8ecd77b'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:5cba2dd68378deb9bcae06f5eac12bd3caa39ba5f121d45914950ac4ffb2aa91'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:30f98000bddd30df6d8d9a13067c83b64806002d24c35cc3ea13e5a0a5ca885f'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:5428e9080b0a4f97fa20b930c4b9681519296d470a2cc8b24151ff9ad39fa360'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.9","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.9/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260822044742'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.9"}'::jsonb
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
      '1.2.9',
      'published',
      '## 1.2.9 - 2026-08-23

- Added six-character class join codes and retired the reusable-link and direct-invitation onboarding flows.
- Added name-based record matching with explicit member confirmation as a fallback when verified-email matching finds no candidate.
- Added officer-editable corrections and notes on member profiles, with per-term meeting attendance correction.
- Simplified the import workbook flow to read application workbooks directly instead of requiring column configuration, with AI-assisted row analysis.
- Simplified the member home and My CSF workspace to mirror the officer per-term view, and fixed connect-request feedback.
- Diagnosed the Google Drive picker key against the current origin before opening the picker.
',
      '36f83b60a5f0a061997e3913a06cafed2a88e966',
      '6e5de7e0712cefb639fc669f5c481c07a5374dd3e00cf44f36ac7a03624432a6',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'fdf9e2c117e8303022c5ab89bea2cb7fd8ecd77b',
      'sha256:5cba2dd68378deb9bcae06f5eac12bd3caa39ba5f121d45914950ac4ffb2aa91',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:30f98000bddd30df6d8d9a13067c83b64806002d24c35cc3ea13e5a0a5ca885f',
      'sha256:5428e9080b0a4f97fa20b930c4b9681519296d470a2cc8b24151ff9ad39fa360',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.9","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.9/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260822044742',
      '{"minimum":"1.1.0","maximum":"1.2.9"}'::jsonb,
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
