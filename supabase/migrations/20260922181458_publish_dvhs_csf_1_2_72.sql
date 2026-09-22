-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.72';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1c8a8d9b72d68d43e5268342cf3554e5d1d5c367'
      OR v_existing.manifest_hash IS DISTINCT FROM 'ad531d4caab2a75d4f9684464052da6d41623f884f531fab9005636115c1d1d0'
      OR v_existing.source_tree IS DISTINCT FROM '20f2e17cc4b0d6bdb14c455c1a5be55b7626c194'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:36eee9a600f23544a9331df1e2cd509c217c33d349c0d2eb6d62c4451fac7239'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:dd3b2fa09d8d8744c6c59895843f7205ea86842d7532fe61b161caf2de4af989'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.72","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.72/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.72"}'::jsonb
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
      '1.2.72',
      'published',
      '## 1.2.72

The officer application roster reads published outcomes from the application record. Accepted and rejected applications leave the pending queue after a Sheet release, even when no in-app review period exists. The same outcome drives the roster badge, detail header, and assignment counts. Point review keeps its separate review decisions.
',
      '1c8a8d9b72d68d43e5268342cf3554e5d1d5c367',
      'ad531d4caab2a75d4f9684464052da6d41623f884f531fab9005636115c1d1d0',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '20f2e17cc4b0d6bdb14c455c1a5be55b7626c194',
      'sha256:36eee9a600f23544a9331df1e2cd509c217c33d349c0d2eb6d62c4451fac7239',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:dd3b2fa09d8d8744c6c59895843f7205ea86842d7532fe61b161caf2de4af989',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.72","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.72/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.72"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.72',
      code_reference = '1c8a8d9b72d68d43e5268342cf3554e5d1d5c367',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.71'
    AND code_reference = 'fd07c59049cfbd17d7e8d0a1c104898e7e762c14';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.72'
      AND code_reference = '1c8a8d9b72d68d43e5268342cf3554e5d1d5c367'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
