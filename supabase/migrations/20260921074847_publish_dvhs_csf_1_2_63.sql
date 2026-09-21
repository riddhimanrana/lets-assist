-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.63';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd57107a9efafe51abed7f07c25cec48c7b65cf03'
      OR v_existing.manifest_hash IS DISTINCT FROM 'b01ea6f8e8a073ab599a044ed6186a839221e3c105e8d334b1b71e6deeaf5211'
      OR v_existing.source_tree IS DISTINCT FROM 'c328a30e6eb176c5720e8a806ad339306298701d'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:94ea60288ab084e81f96bcf101eb9406b2f655b9115901da86484a2ed4095228'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:478777b8d156fa9867608a3ed51ab2f1cd18e1dfd9bd6aa40d951ab6799225de'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.63","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.63/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.63"}'::jsonb
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
      '1.2.63',
      'published',
      '## 1.2.63

- Reduce Sheet sync permission reads by checking only staff with verified Google connections. Recheck access before every export without caching permissions.
',
      'd57107a9efafe51abed7f07c25cec48c7b65cf03',
      'b01ea6f8e8a073ab599a044ed6186a839221e3c105e8d334b1b71e6deeaf5211',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'c328a30e6eb176c5720e8a806ad339306298701d',
      'sha256:94ea60288ab084e81f96bcf101eb9406b2f655b9115901da86484a2ed4095228',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:478777b8d156fa9867608a3ed51ab2f1cd18e1dfd9bd6aa40d951ab6799225de',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.63","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.63/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.63"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.63',
      code_reference = 'd57107a9efafe51abed7f07c25cec48c7b65cf03',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.61'
    AND code_reference = '63de568899ed8f7f4dec7730fca05516bc0ea435';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.63'
      AND code_reference = 'd57107a9efafe51abed7f07c25cec48c7b65cf03'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
