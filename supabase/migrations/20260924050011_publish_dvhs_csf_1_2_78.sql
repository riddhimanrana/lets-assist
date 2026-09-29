-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.78';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '8ecfcfdeb6b15be5ced3d452924d70206256f6e4'
      OR v_existing.manifest_hash IS DISTINCT FROM '448589329b7440411f7c15d2a94c6918e58230e919311f28deb3527b0d256145'
      OR v_existing.source_tree IS DISTINCT FROM '46cbd2f1008c10790babb9e6490c60a8d6798b7a'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4642fcb3cdda8e73b9d716db0cd72491c2610362ab70797cd0da1b328eb1ae16'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:8f1dd58d2810da27f222fba292f3d619978f7890bff00989ef1418a7dd6bb7d1'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.78","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.78/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260924034956'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.78"}'::jsonb
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
      '1.2.78',
      'published',
      '## 1.2.78

Activities use compact rows with Create, search and collapse controls. Pacific week sections organize dated activities automatically; officer moves persist when dates change. Keyboard and touch controls support the same ordering. Dates and location are optional.

Feed, My CSF and Point submissions share capped totals: submitted points appear in blue and approved points in green. The submission picker includes upcoming and past term activities with availability labels. My CSF keeps one semester selector and one progress summary.

Members can inspect and edit unreviewed submissions without losing proof history. Revision checks prevent students and officers from saving over changes they have not seen. After qualifying points reach the term requirement, members receive one optional platform experience rating prompt. Ratings and comments stay private to their author and platform admins.
',
      '8ecfcfdeb6b15be5ced3d452924d70206256f6e4',
      '448589329b7440411f7c15d2a94c6918e58230e919311f28deb3527b0d256145',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '46cbd2f1008c10790babb9e6490c60a8d6798b7a',
      'sha256:4642fcb3cdda8e73b9d716db0cd72491c2610362ab70797cd0da1b328eb1ae16',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:8f1dd58d2810da27f222fba292f3d619978f7890bff00989ef1418a7dd6bb7d1',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.78","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.78/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260924034956',
      '{"minimum":"1.1.0","maximum":"1.2.78"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.78',
      code_reference = '8ecfcfdeb6b15be5ced3d452924d70206256f6e4',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.77'
    AND code_reference = '400af29c570bf3f1df6f6b5d05aee56e38ff1d07';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.78'
      AND code_reference = '8ecfcfdeb6b15be5ced3d452924d70206256f6e4'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
