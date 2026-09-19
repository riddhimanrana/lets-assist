-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.52';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '7735472c1e0fc663bc855fb158e2d8e9c026d2a7'
      OR v_existing.manifest_hash IS DISTINCT FROM 'e733b7910fb76665c9b9116c81d72924ba81497f97719b74ccd516b85329148f'
      OR v_existing.source_tree IS DISTINCT FROM '851123be343ac92a7182f2c3c9be57a4aa21da88'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:11a098a91081c4ef5e60a1e3502eb0558e9ccca6b12fae282e4cd9cbf93b7e6a'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:0350524fb471b7982ab59007187d04b722899cddfc48dea8f48ce0fd0692277b'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.52","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.52/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260919020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.52"}'::jsonb
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
      '1.2.52',
      'published',
      '## 1.2.52

- Allow officers to add up to four private flyer images to a post, edit image descriptions, and show responsive image galleries to the post audience.
- Keep Google Sheets as the Fall 2026 application review source, preserve private decisions until release, and record review evidence without writing over the source decisions.
- Improve account-link review, member pending-state copy, attendance reconciliation, roster editing, and class join flows.
- Reduce Applications and member-directory load time by overlapping independent reads and mounting record tools only when needed.
- Complete CSF post and activity notifications with direct links while respecting recipient and email preferences.
',
      '7735472c1e0fc663bc855fb158e2d8e9c026d2a7',
      'e733b7910fb76665c9b9116c81d72924ba81497f97719b74ccd516b85329148f',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '851123be343ac92a7182f2c3c9be57a4aa21da88',
      'sha256:11a098a91081c4ef5e60a1e3502eb0558e9ccca6b12fae282e4cd9cbf93b7e6a',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:0350524fb471b7982ab59007187d04b722899cddfc48dea8f48ce0fd0692277b',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.52","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.52/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260919020000',
      '{"minimum":"1.1.0","maximum":"1.2.52"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.52',
      code_reference = '7735472c1e0fc663bc855fb158e2d8e9c026d2a7',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.51'
    AND code_reference = 'acc5e10640c57bda8856e966ebbc017b78365cc5';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.52'
      AND code_reference = '7735472c1e0fc663bc855fb158e2d8e9c026d2a7'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
