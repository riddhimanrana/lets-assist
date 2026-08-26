-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.15';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'dbd4b387f8931750d756d14cb3438be4232a120f'
      OR v_existing.manifest_hash IS DISTINCT FROM '97782a57c174c4c717a1cb0bf2e3061c40f11dc71834fe342a6427d938eb2533'
      OR v_existing.source_tree IS DISTINCT FROM '8bec88c943f873e4cb15f5329b6c3dd27a26b207'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:6a5e20a287a51a174d784b43ce287427392713895596e0683a234f1198e3dc42'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:98252aa899cba31c0a5dd73ad4c9784b5ca7fe5a8c790a5c6b69d5868fe86b94'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:8eb0ed0429c2e1d7922a412e979621348e935e399cbafcea2fbc0a3cc6c71ff1'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.15","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.15/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260825170000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.15"}'::jsonb
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
      '1.2.15',
      'published',
      '## 1.2.15 - 2026-08-26

- Retain unmatched Google Sheets comment content, replies, and provider
  coordinates in immutable preview evidence, and show officers a bounded manual
  placement sample without guessing a target cell.
',
      'dbd4b387f8931750d756d14cb3438be4232a120f',
      '97782a57c174c4c717a1cb0bf2e3061c40f11dc71834fe342a6427d938eb2533',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '8bec88c943f873e4cb15f5329b6c3dd27a26b207',
      'sha256:6a5e20a287a51a174d784b43ce287427392713895596e0683a234f1198e3dc42',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:98252aa899cba31c0a5dd73ad4c9784b5ca7fe5a8c790a5c6b69d5868fe86b94',
      'sha256:8eb0ed0429c2e1d7922a412e979621348e935e399cbafcea2fbc0a3cc6c71ff1',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.15","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.15/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260825170000',
      '{"minimum":"1.1.0","maximum":"1.2.15"}'::jsonb,
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
