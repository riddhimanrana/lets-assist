-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.73';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '289558fca951efe404b3481b56a0d855a4db29e3'
      OR v_existing.manifest_hash IS DISTINCT FROM '789745437bc893e4c1cfa3828ed70a2e1b3f7f5235593bf8dd4422a3e8fa8c7b'
      OR v_existing.source_tree IS DISTINCT FROM '6a93bc87273fe2264219b07847441619dcc20225'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:1858da4581d838b1d3250db77308840eb37bcf03e377fdd197a1bd481b64a786'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:435528078e58c05fa7469bdcac7393f1c75e60d0dc3c75be5ccd7719ebded627'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.73","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.73/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260922232103'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.73"}'::jsonb
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
      '1.2.73',
      'published',
      '## 1.2.73

Officers can organize activities into saved semester sections, reorder them, and move activities by drag handle or accessible controls. Members see the same section order. Date filters use the actual shifts in each Pacific week, and activity details show a schedule that fits phone screens.

Point review loads all finalized proof attachments with image and PDF previews, original downloads, and explicit loading and failure states. Class settings expose the existing failed-row recovery actions. Published application outcomes take precedence over pending legacy checks in the member directory.

My CSF includes the personal Google Calendar workspace. Each shift has a stable calendar identity, and recovery retains events that need updating or removal. Activity emails include the description, dates, location, point rules, signup links and proof requirements through the existing consent and delivery workflow.

The feed removes redundant panels, adds a semester-specific approval badge and member celebration, and improves image viewing. Navigation, proof loading, activity filtering and saves show pending states.
',
      '289558fca951efe404b3481b56a0d855a4db29e3',
      '789745437bc893e4c1cfa3828ed70a2e1b3f7f5235593bf8dd4422a3e8fa8c7b',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '6a93bc87273fe2264219b07847441619dcc20225',
      'sha256:1858da4581d838b1d3250db77308840eb37bcf03e377fdd197a1bd481b64a786',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:435528078e58c05fa7469bdcac7393f1c75e60d0dc3c75be5ccd7719ebded627',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.73","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.73/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260922232103',
      '{"minimum":"1.1.0","maximum":"1.2.73"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.73',
      code_reference = '289558fca951efe404b3481b56a0d855a4db29e3',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.72'
    AND code_reference = '1c8a8d9b72d68d43e5268342cf3554e5d1d5c367';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.73'
      AND code_reference = '289558fca951efe404b3481b56a0d855a4db29e3'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
