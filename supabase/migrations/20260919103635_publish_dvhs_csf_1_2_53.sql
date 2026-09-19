-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.53';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '11d3f531b4b74ef9dd0a3a332604a4c80b835448'
      OR v_existing.manifest_hash IS DISTINCT FROM 'f2d8be8fc61df0beefcbd708f8e9f3406615976b4cdb86439da40d610cbe7275'
      OR v_existing.source_tree IS DISTINCT FROM 'b3fca88cb928fa8b184d9476587034fc7bc282f1'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:5195daa5c691ea97edbe27b3c21a75bfcdd0baf8aefde036ab81f7ead229ffd4'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:90fd3517edf5cc2f1015a282f6ec8db073b5baa90cd32423c2f3d0d28f94a393'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.53","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.53/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260919095826'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.53"}'::jsonb
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
      '1.2.53',
      'published',
      '## 1.2.53

- Require the platform''s atomic post and attachment update migration before installing the flyer editing release.
',
      '11d3f531b4b74ef9dd0a3a332604a4c80b835448',
      'f2d8be8fc61df0beefcbd708f8e9f3406615976b4cdb86439da40d610cbe7275',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'b3fca88cb928fa8b184d9476587034fc7bc282f1',
      'sha256:5195daa5c691ea97edbe27b3c21a75bfcdd0baf8aefde036ab81f7ead229ffd4',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:90fd3517edf5cc2f1015a282f6ec8db073b5baa90cd32423c2f3d0d28f94a393',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.53","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.53/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260919095826',
      '{"minimum":"1.1.0","maximum":"1.2.53"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.53',
      code_reference = '11d3f531b4b74ef9dd0a3a332604a4c80b835448',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.51'
    AND code_reference = 'acc5e10640c57bda8856e966ebbc017b78365cc5';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.53'
      AND code_reference = '11d3f531b4b74ef9dd0a3a332604a4c80b835448'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
