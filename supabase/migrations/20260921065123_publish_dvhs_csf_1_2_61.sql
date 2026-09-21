-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.61';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '63de568899ed8f7f4dec7730fca05516bc0ea435'
      OR v_existing.manifest_hash IS DISTINCT FROM '88937118696e02ef3401544f097c200a5d04ed8954f5421d04fd5e026a8d0f38'
      OR v_existing.source_tree IS DISTINCT FROM 'a5c0be4415533a8b6c504b5906c05dd052f105ed'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:c213de2606a6f836cb2549cefbd96ea61c38ceeb512c48505129934d0c71d2d4'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:de0df3ad504849156250931783eff42b53ec26cdbcc5ebf84ba636ca25223164'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.61","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.61/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.61"}'::jsonb
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
      '1.2.61',
      'published',
      '## 1.2.61

- Remove the duplicate Auth and membership check before the application list. Recheck current access before every read and retry.
- Clarify that Sheet note columns stay private and yellow decisions await another officer.
',
      '63de568899ed8f7f4dec7730fca05516bc0ea435',
      '88937118696e02ef3401544f097c200a5d04ed8954f5421d04fd5e026a8d0f38',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'a5c0be4415533a8b6c504b5906c05dd052f105ed',
      'sha256:c213de2606a6f836cb2549cefbd96ea61c38ceeb512c48505129934d0c71d2d4',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:de0df3ad504849156250931783eff42b53ec26cdbcc5ebf84ba636ca25223164',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.61","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.61/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.61"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.61',
      code_reference = '63de568899ed8f7f4dec7730fca05516bc0ea435',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.60'
    AND code_reference = 'e923b4eacf26c9c39b292428b3c294fd7809f363';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.61'
      AND code_reference = '63de568899ed8f7f4dec7730fca05516bc0ea435'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
