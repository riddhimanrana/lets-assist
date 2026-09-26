-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.81';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '613ebefecc02cfd03b1dc4f4f1dc70348461fd5e'
      OR v_existing.manifest_hash IS DISTINCT FROM 'd0ce7d181942f22d9e541f2c076d1a9ba4f71f8a8e8a75ecd2d3a797579817ba'
      OR v_existing.source_tree IS DISTINCT FROM 'f07a446a5f4c77d2e806ea45812e1ac7f3d7d16f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:7da4c22b011d6a6e3ea28a0222eb647dde8cbbb34007519178bea73b8b2ae146'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:6ecc7ba8ef5ba58611812fd6d0a50407436e1f7a448c05a08708d0a9bc9d4738'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.81","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.81/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260924095624'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.81"}'::jsonb
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
      '1.2.81',
      'published',
      '## 1.2.81

Officers can review larger proof images and PDF pages with zoom, rotation, and page controls. Review actions prevent repeated writes and explain when an interrupted response needs a reload.

Semester controls follow the selected semester, expose reopening, and block empty-term closure. Starting the next semester keeps the previous one open. Class archive and restore require confirmation, preserve history, and show saved results. Failed forms retain entered values.

Sheet status reads show loading and retry states and ignore stale responses. Partner clubs support search and standing filters, with creation and import tied to the displayed semester. Graduation guidance separates final-term closure, recognition review, archival, and incoming-class creation.
',
      '613ebefecc02cfd03b1dc4f4f1dc70348461fd5e',
      'd0ce7d181942f22d9e541f2c076d1a9ba4f71f8a8e8a75ecd2d3a797579817ba',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'f07a446a5f4c77d2e806ea45812e1ac7f3d7d16f',
      'sha256:7da4c22b011d6a6e3ea28a0222eb647dde8cbbb34007519178bea73b8b2ae146',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:6ecc7ba8ef5ba58611812fd6d0a50407436e1f7a448c05a08708d0a9bc9d4738',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.81","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.81/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260924095624',
      '{"minimum":"1.1.0","maximum":"1.2.81"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.81',
      code_reference = '613ebefecc02cfd03b1dc4f4f1dc70348461fd5e',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.80'
    AND code_reference = 'a294ee5b7cf5a9a0202aed0f26a870d8289971e9';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.81'
      AND code_reference = '613ebefecc02cfd03b1dc4f4f1dc70348461fd5e'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
