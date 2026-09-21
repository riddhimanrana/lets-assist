-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.59';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '8c38db8e11b7c37d7f68977364e9bfe0e141d28c'
      OR v_existing.manifest_hash IS DISTINCT FROM '8c91a93dba7f3fbdadac131fbf896c48cccdfed1358a86f4c08031daf270c5e7'
      OR v_existing.source_tree IS DISTINCT FROM 'afc24f3b68e4cb5be3fc974b29b1e7124e47e2a1'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:ced375bb18e237e8109dd9976020e4bccdbed44fa6109b7b31bd00cf239527c5'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:995f8e1740a4e29302ce531706312a30636f5c57ccd627116087eff456712733'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.59","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.59/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.59"}'::jsonb
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
      '1.2.59',
      'published',
      '## 1.2.59

- Match application responses with one searchable student picker showing class and contact details. Ask for notes only when identity evidence needs review.
- Show only unresolved responses in matching. Move Sheet settings, source checks, and import history into a separate view.
- Keep failed imports in recovery and recheck routine matches before saving them.
',
      '8c38db8e11b7c37d7f68977364e9bfe0e141d28c',
      '8c91a93dba7f3fbdadac131fbf896c48cccdfed1358a86f4c08031daf270c5e7',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'afc24f3b68e4cb5be3fc974b29b1e7124e47e2a1',
      'sha256:ced375bb18e237e8109dd9976020e4bccdbed44fa6109b7b31bd00cf239527c5',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:995f8e1740a4e29302ce531706312a30636f5c57ccd627116087eff456712733',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.59","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.59/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.59"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.59',
      code_reference = '8c38db8e11b7c37d7f68977364e9bfe0e141d28c',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.58'
    AND code_reference = '6ea7f6905f35ed0c38d74561ceaab202e4197bba';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.59'
      AND code_reference = '8c38db8e11b7c37d7f68977364e9bfe0e141d28c'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
