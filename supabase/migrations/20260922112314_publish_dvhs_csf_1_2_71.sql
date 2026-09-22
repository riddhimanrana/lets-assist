-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.71';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'fd07c59049cfbd17d7e8d0a1c104898e7e762c14'
      OR v_existing.manifest_hash IS DISTINCT FROM '33cd7a87a55809fbd00f8852157a56e6f1ac9c273c6e1d8abfed2c5a4340a055'
      OR v_existing.source_tree IS DISTINCT FROM '0202d235077ec43307e6b6c97beb3488984b58cb'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4484e819916c4bee79783f0c073120d748f6bf77d2b54455761695de788adf60'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:e3e4c63865fc1c85fa9545dfe6b52bfc34a4087990fea1a370a4630743a02cff'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.71","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.71/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922054000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.71"}'::jsonb
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
      '1.2.71',
      'published',
      '## 1.2.71

The month calendar uses saved shift dates for activities with selectable shifts. It leaves the days between shifts empty and includes shifts in the selected month even when the activity has no outer date range. Each entry opens the same activity and displays that shift''s time and points. Existing class access and private deadline restrictions remain enforced on the server.
',
      'fd07c59049cfbd17d7e8d0a1c104898e7e762c14',
      '33cd7a87a55809fbd00f8852157a56e6f1ac9c273c6e1d8abfed2c5a4340a055',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '0202d235077ec43307e6b6c97beb3488984b58cb',
      'sha256:4484e819916c4bee79783f0c073120d748f6bf77d2b54455761695de788adf60',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:e3e4c63865fc1c85fa9545dfe6b52bfc34a4087990fea1a370a4630743a02cff',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.71","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.71/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922054000',
      '{"minimum":"1.1.0","maximum":"1.2.71"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.71',
      code_reference = 'fd07c59049cfbd17d7e8d0a1c104898e7e762c14',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.70'
    AND code_reference = '6ffd1da307220ab60e2cf1c12e31321ff2fdfa59';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.71'
      AND code_reference = 'fd07c59049cfbd17d7e8d0a1c104898e7e762c14'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
