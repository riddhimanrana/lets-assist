-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.88';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '4322648cebb79a82d050105910b5c2faf6ee44d8'
      OR v_existing.manifest_hash IS DISTINCT FROM '81a5741a2957d479bfca021fa51399997676e586c57fb29e3877507289a9d4a0'
      OR v_existing.source_tree IS DISTINCT FROM 'f89b9baf27d4a28dd2ad6201a8d5c79d24a13a9a'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:780b5a7d9e4f5b87c7bdfc75eb9ea66e635a2a913b7bb1881ef15a295b6c8af0'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:a1fbd8ce5009bcc9c99a138fc438cfbc2447fa086d20e92fe02d2b64fa9546ed'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.88","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.88/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20261011110000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.88"}'::jsonb
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
      '1.2.88',
      'published',
      '## 1.2.88

- Page application roster reads on the server while preserving the complete filtered review queue and name ordering.
- Keep queues, loaded applications, pending decisions and rejection drafts scoped to the displayed organization, reviewer and list visit.
- Ignore late reads and decisions after leaving or returning to a review queue, and keep panel loading callbacks stable.
- Require the platform roster-paging migration. Existing installs remain pinned until an authorized control-plane update.
',
      '4322648cebb79a82d050105910b5c2faf6ee44d8',
      '81a5741a2957d479bfca021fa51399997676e586c57fb29e3877507289a9d4a0',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'f89b9baf27d4a28dd2ad6201a8d5c79d24a13a9a',
      'sha256:780b5a7d9e4f5b87c7bdfc75eb9ea66e635a2a913b7bb1881ef15a295b6c8af0',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:a1fbd8ce5009bcc9c99a138fc438cfbc2447fa086d20e92fe02d2b64fa9546ed',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.88","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.88/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20261011110000',
      '{"minimum":"1.1.0","maximum":"1.2.88"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.88',
      code_reference = '4322648cebb79a82d050105910b5c2faf6ee44d8',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.87'
    AND code_reference = '2c55aba805d50a981d1bc50c0755dcde5c7830ca';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.88'
      AND code_reference = '4322648cebb79a82d050105910b5c2faf6ee44d8'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
