-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.76';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'd833c0052cf812906b0a9e8b70429b767544ea90'
      OR v_existing.manifest_hash IS DISTINCT FROM 'fded388a089224af69e68e08597b8946778f2492cf51d3505a4c7d4dae40cace'
      OR v_existing.source_tree IS DISTINCT FROM '6ab4a4a575dabae149437d9a6cdf0d6ac2b02052'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:d52db48731ea9dce6b6ef1250bfffe28aa5cfdbed2bea7f51cff20367bdf6e3f'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:f8d96bc04c5f063c36a0999b8c9995407ac25f9709c8fd105c9111a1d6146dc9'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.76","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.76/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260923033020'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.76"}'::jsonb
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
      '1.2.76',
      'published',
      '## 1.2.76

Activities use one collapsible section list for members and officers. Officers arrange rows by drag handle or Move to, and edit activities from one menu. Search and section controls stay visible; date and week filters sit under Filters. Section order is the default, including before the first section is added.

Point submission forms show one preview per attachment, including HEIC previews, with a full-size viewer and removal controls. Selected shifts supply their Pacific date. Pending requests expose Unsubmit. Other requests require proof and an explicit officer decision before credits are awarded. Activity details retain the submission action without the Getting credit panel.

CSF uses the in-app calendar. Google Calendar export controls and provider workspace reads are removed, while existing provider records remain available to cleanup workflows.

- Save activity announcement intent with publication, freeze its content and audience, and recover interrupted preparation without another campaign. Officers can preview the email and recipient count, then inspect or retry preparation from Email status.

Officer Home, Help, semester blockers and Sheet record links now open the class and semester submission queue. The officer navigation exposes Point submissions, and the legacy service page links to the same queue while retaining credit and appeal tools.
',
      'd833c0052cf812906b0a9e8b70429b767544ea90',
      'fded388a089224af69e68e08597b8946778f2492cf51d3505a4c7d4dae40cace',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '6ab4a4a575dabae149437d9a6cdf0d6ac2b02052',
      'sha256:d52db48731ea9dce6b6ef1250bfffe28aa5cfdbed2bea7f51cff20367bdf6e3f',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:f8d96bc04c5f063c36a0999b8c9995407ac25f9709c8fd105c9111a1d6146dc9',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.76","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.76/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260923033020',
      '{"minimum":"1.1.0","maximum":"1.2.76"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.76',
      code_reference = 'd833c0052cf812906b0a9e8b70429b767544ea90',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.75'
    AND code_reference = 'ed9eb5b3ed5fd4d69162d55cc20477323247e94c';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.76'
      AND code_reference = 'd833c0052cf812906b0a9e8b70429b767544ea90'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
