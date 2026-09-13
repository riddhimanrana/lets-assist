-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.41';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '74d7372fef09b22eb06fb31285607eb7d80e38d3'
      OR v_existing.manifest_hash IS DISTINCT FROM '4b6b30e5d2f8ab9498da0b045e3f8319cd95ff57fc287b892c33f54431042d90'
      OR v_existing.source_tree IS DISTINCT FROM '086489a4fe73239e8993d9e9942cbc030d9340df'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:aa7bac9929a4e032d46b53fb548fe4eb3cf1835c265dd2425087eea16c5bd32f'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:b00499cbde66be6ede5424e98a16b160fcb182599d1394da389ec5aad2a43156'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.41","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.41/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260913061610'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.41"}'::jsonb
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
      '1.2.41',
      'published',
      '## 1.2.41

- Check linked class workbooks from officer Home without reporting intentionally unlinked classes as failed.
',
      '74d7372fef09b22eb06fb31285607eb7d80e38d3',
      '4b6b30e5d2f8ab9498da0b045e3f8319cd95ff57fc287b892c33f54431042d90',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '086489a4fe73239e8993d9e9942cbc030d9340df',
      'sha256:aa7bac9929a4e032d46b53fb548fe4eb3cf1835c265dd2425087eea16c5bd32f',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:b00499cbde66be6ede5424e98a16b160fcb182599d1394da389ec5aad2a43156',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.41","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.41/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260913061610',
      '{"minimum":"1.1.0","maximum":"1.2.41"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.41',
      code_reference = '74d7372fef09b22eb06fb31285607eb7d80e38d3',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.40'
    AND code_reference = '925d5ca047d7c21f03ea74d258873372c0d4fd14';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.41'
      AND code_reference = '74d7372fef09b22eb06fb31285607eb7d80e38d3'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
