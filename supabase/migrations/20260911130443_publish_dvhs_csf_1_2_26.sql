-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.26';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'bb819efce4f4c8c9597b3598f3665a3538243d53'
      OR v_existing.manifest_hash IS DISTINCT FROM 'c2af1ba8257d81d2d40292e97cf9ef619a74dccaf80e38be973f5427ad0ac3bf'
      OR v_existing.source_tree IS DISTINCT FROM '833e0c4b9058788cbc7334aa96207ec5b8e7f20d'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:8ed6bea527e3b9eade2eed4aa37818d03396d4b58811685e7386ce672b433745'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:e6bbb715ba08842562bdc231d0a2f2969c5daea993c55849e613f1790d844c3c'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:6b1cde9307ae1be65bc1f0d6481df2d649dd2c7596fcdfc57e805d6d26409025'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.26","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.26/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260910232532'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.26"}'::jsonb
      OR v_existing.runtime_profile IS DISTINCT FROM 'application'
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
      '1.2.26',
      'published',
      '## 1.2.26

- Load complete review rosters, courses, evidence and verified points in bounded pages. Report failed reads instead of showing incomplete records.
- Include staff who have no student profile in review assignments, using their account names. Report unavailable review settings instead of treating them as missing.
- Check the Sheets comment byte limit before sending comments or replies. Preserve oversized messages in Let''s Assist and hold their export with a clear reason.
',
      'bb819efce4f4c8c9597b3598f3665a3538243d53',
      'c2af1ba8257d81d2d40292e97cf9ef619a74dccaf80e38be973f5427ad0ac3bf',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '833e0c4b9058788cbc7334aa96207ec5b8e7f20d',
      'sha256:8ed6bea527e3b9eade2eed4aa37818d03396d4b58811685e7386ce672b433745',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:e6bbb715ba08842562bdc231d0a2f2969c5daea993c55849e613f1790d844c3c',
      'sha256:6b1cde9307ae1be65bc1f0d6481df2d649dd2c7596fcdfc57e805d6d26409025',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.26","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.26/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260910232532',
      '{"minimum":"1.1.0","maximum":"1.2.26"}'::jsonb,
      'application',
      now()
    );
  END IF;

  PERFORM 1
  FROM public.plugins
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.1.0'
    AND code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
