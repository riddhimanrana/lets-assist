-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dv-speech-debate'
    AND version = '2.0.2';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '99c3df1a7e9f39523c7a615017461c14ed88c7fc'
      OR v_existing.manifest_hash IS DISTINCT FROM '745f4422d3e59bb38ff26f1219bb91881864f7226e83f78677bc90ad46d19861'
      OR v_existing.source_tree IS DISTINCT FROM '8f1bbfcb8000e468f5339e6e004ee17def0cede0'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:5b7facdf91a1338bf19373007e413e1cea168f606bec8300480ae985b660c845'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dv-speech-debate"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:634933965c17e2233bfc8d3e6961d61c6aae099c6ec53ca458ba5c6ea87571a2'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dv-speech-debate/v2.0.2","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dv-speech-debate/v2.0.2/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260412000001'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"2.0.0","maximum":"2.0.2"}'::jsonb
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
      'dv-speech-debate',
      '2.0.2',
      'published',
      '## 2.0.2 - 2026-08-23

- Bound AI gateway accounting to the DV Speech & Debate plugin and organization.
- Published the signed plugin tree from the platform integration baseline.
',
      '99c3df1a7e9f39523c7a615017461c14ed88c7fc',
      '745f4422d3e59bb38ff26f1219bb91881864f7226e83f78677bc90ad46d19861',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '8f1bbfcb8000e468f5339e6e004ee17def0cede0',
      'sha256:5b7facdf91a1338bf19373007e413e1cea168f606bec8300480ae985b660c845',
      '["plugins/dv-speech-debate"]'::jsonb,
      NULL,
      'sha256:634933965c17e2233bfc8d3e6961d61c6aae099c6ec53ca458ba5c6ea87571a2',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dv-speech-debate/v2.0.2","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dv-speech-debate/v2.0.2/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0"}'::jsonb,
      1,
      '20260412000001',
      '{"minimum":"2.0.0","maximum":"2.0.2"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '2.0.2',
      code_reference = '99c3df1a7e9f39523c7a615017461c14ed88c7fc',
      updated_at = now()
  WHERE key = 'dv-speech-debate'
    AND latest_version = '2.0.0'
    AND code_reference = '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dv-speech-debate'
      AND latest_version = '2.0.2'
      AND code_reference = '99c3df1a7e9f39523c7a615017461c14ed88c7fc'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
