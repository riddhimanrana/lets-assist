-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.77';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '400af29c570bf3f1df6f6b5d05aee56e38ff1d07'
      OR v_existing.manifest_hash IS DISTINCT FROM '6f3c43c27bb1037bf874126525089a62c4b748a99261d86897054a3ac90de2d9'
      OR v_existing.source_tree IS DISTINCT FROM '65061c73e40632be8b6cdc0645d7b6a1a7df7189'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:123576bc20ee76739833036808651cd54e798e0554dca22c272f40444d4767ec'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:71155048efd54e91087cb0fd5528a12b3da2cf8ff7556bcb6c2ab0c3967cedf0'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.77","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.77/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260923200000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.77"}'::jsonb
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
      '1.2.77',
      'published',
      '## 1.2.77

The activity editor uses a wide desktop layout and a full-height phone dialog with persistent Save as draft and Publish controls. Dates, location and signup sit together. Extra signup links, host details and point limits expand when needed and preserve their values when closed. Shift activities keep their overall date range separate from individual shifts.

Point submissions include optional notes beside proof. Large image selections resize before upload to fit the hosted request limit, including local HEIC conversion. Failed uploads retain files and prepared retry bytes.

The officer activity menu no longer offers Close signups. Previously closed activities show Hidden and offer Restore activity. Restoration keeps the original dates, points and publication receipts, does not send another announcement, and respects semester locks and officer permissions.
',
      '400af29c570bf3f1df6f6b5d05aee56e38ff1d07',
      '6f3c43c27bb1037bf874126525089a62c4b748a99261d86897054a3ac90de2d9',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '65061c73e40632be8b6cdc0645d7b6a1a7df7189',
      'sha256:123576bc20ee76739833036808651cd54e798e0554dca22c272f40444d4767ec',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:71155048efd54e91087cb0fd5528a12b3da2cf8ff7556bcb6c2ab0c3967cedf0',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.77","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.77/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260923200000',
      '{"minimum":"1.1.0","maximum":"1.2.77"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.77',
      code_reference = '400af29c570bf3f1df6f6b5d05aee56e38ff1d07',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.76'
    AND code_reference = 'd833c0052cf812906b0a9e8b70429b767544ea90';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.77'
      AND code_reference = '400af29c570bf3f1df6f6b5d05aee56e38ff1d07'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
