-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.58';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '6ea7f6905f35ed0c38d74561ceaab202e4197bba'
      OR v_existing.manifest_hash IS DISTINCT FROM '8128b76688c41140de0407da95edb412c6a5455d3e2497bdc45af25bf68cc2ed'
      OR v_existing.source_tree IS DISTINCT FROM '442c6402df079e42d1dfa2cf04cdf5337bf174ae'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:9f35002d4a62c0a2876b2f86b2dacd7ca00b710e329681e47d4a1bb98c2450ab'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:19f042b4e1fef9f26a0a21ed66a402e2d1141664608b042c9d198fceef29a2a0'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.58","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.58/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260920181754'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.58"}'::jsonb
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
      '1.2.58',
      'published',
      '## 1.2.58

- Keep each application response tab as a separate source. Hold conflicting copied responses without treating the copy as a verified match.
- Show the recorded successful check and recovery action when a class sheet exhausts its retries.

- Treat yellow Sheet marks as holds and require officer approval for every decision release, including changes after an earlier release. Keep Sheet comments private.
- Simplify application sync, class rosters, Home announcements, activity cards, and meeting details. Remove application review splits from the active interface.
- Show applicants separately from semester members and report retryable source failures by class.
- Count already-recorded attendance separately from unresolved responses and keep meeting imports scoped to their saved meeting identity.
- Queue account, access, and decision notices through the existing notification workers with the chapter sender name.
',
      '6ea7f6905f35ed0c38d74561ceaab202e4197bba',
      '8128b76688c41140de0407da95edb412c6a5455d3e2497bdc45af25bf68cc2ed',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '442c6402df079e42d1dfa2cf04cdf5337bf174ae',
      'sha256:9f35002d4a62c0a2876b2f86b2dacd7ca00b710e329681e47d4a1bb98c2450ab',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:19f042b4e1fef9f26a0a21ed66a402e2d1141664608b042c9d198fceef29a2a0',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.58","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.58/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260920181754',
      '{"minimum":"1.1.0","maximum":"1.2.58"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.58',
      code_reference = '6ea7f6905f35ed0c38d74561ceaab202e4197bba',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.57'
    AND code_reference = 'c5c285597ea36359780e572039f8a0e7c1d5dc41';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.58'
      AND code_reference = '6ea7f6905f35ed0c38d74561ceaab202e4197bba'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
