-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.51';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'acc5e10640c57bda8856e966ebbc017b78365cc5'
      OR v_existing.manifest_hash IS DISTINCT FROM 'db7368997b3f2ec0c5c325c0479bf2b05d35e0669825d910e4a9e5587acdf110'
      OR v_existing.source_tree IS DISTINCT FROM '2c7846600c696162b6a835a0acca03ca3275320d'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:17289f3c87e4c9c611fc01d77d2590a5fef6fd564c6ed676d658dd0073d4081f'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:4ec0fa240ef65b896a0b24a7ada2c48b4f8a6564e121f9ac4b4c1411f5dec83a'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.51","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.51/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260915161000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.51"}'::jsonb
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
      '1.2.51',
      'published',
      '## 1.2.51

- Accept valid class-code characters as members type or paste, and request a text keyboard on phones.
- Allow up to five proof images in one point submission. Store a page per image in one private PDF while keeping the current review and cleanup transaction. A single image or PDF stays in its original format.
- Show the new point-submission control only when the member has an accepted or active current-semester membership.
- Require officers to confirm the selected class workbook before linking it, and distinguish same-name profiles by semester history and record reference.
',
      'acc5e10640c57bda8856e966ebbc017b78365cc5',
      'db7368997b3f2ec0c5c325c0479bf2b05d35e0669825d910e4a9e5587acdf110',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '2c7846600c696162b6a835a0acca03ca3275320d',
      'sha256:17289f3c87e4c9c611fc01d77d2590a5fef6fd564c6ed676d658dd0073d4081f',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:4ec0fa240ef65b896a0b24a7ada2c48b4f8a6564e121f9ac4b4c1411f5dec83a',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.51","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.51/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260915161000',
      '{"minimum":"1.1.0","maximum":"1.2.51"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.51',
      code_reference = 'acc5e10640c57bda8856e966ebbc017b78365cc5',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.50'
    AND code_reference = '1726e639955c3259ce7565879fd3195a369fb3c3';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.51'
      AND code_reference = 'acc5e10640c57bda8856e966ebbc017b78365cc5'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
