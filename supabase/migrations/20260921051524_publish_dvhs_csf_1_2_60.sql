-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.60';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'e923b4eacf26c9c39b292428b3c294fd7809f363'
      OR v_existing.manifest_hash IS DISTINCT FROM '4d3c3d6c8178fd1657a3ac67341c872479443105bb677a08d7bfdc34113e8d09'
      OR v_existing.source_tree IS DISTINCT FROM '0502944a64e9f482a56bb52a4186de99df5c958f'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:2db10815e940e3dd602f6ca46ec1ae66c28091bb1800ddf9cf1c12558599b13d'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:e79a27d1af95b98defe1404594fd916e5a11c43f66bbef7314d357d04d7e2d01'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.60","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.60/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.60"}'::jsonb
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
      '1.2.60',
      'published',
      '## 1.2.60

- Browse activities by week with search and collapsible sections in chapter and class views.
- Submit points by choosing an activity or club, or naming another activity. Linked submissions no longer require a narrative.
- Preview selected proof images, preserve them after failed submissions, and reject broken images or PDFs before storage.
- Keep the point-submission dialog within the phone viewport when focusing its controls.
',
      'e923b4eacf26c9c39b292428b3c294fd7809f363',
      '4d3c3d6c8178fd1657a3ac67341c872479443105bb677a08d7bfdc34113e8d09',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '0502944a64e9f482a56bb52a4186de99df5c958f',
      'sha256:2db10815e940e3dd602f6ca46ec1ae66c28091bb1800ddf9cf1c12558599b13d',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:e79a27d1af95b98defe1404594fd916e5a11c43f66bbef7314d357d04d7e2d01',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.60","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.60/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.60"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.60',
      code_reference = 'e923b4eacf26c9c39b292428b3c294fd7809f363',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.59'
    AND code_reference = '8c38db8e11b7c37d7f68977364e9bfe0e141d28c';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.60'
      AND code_reference = 'e923b4eacf26c9c39b292428b3c294fd7809f363'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
