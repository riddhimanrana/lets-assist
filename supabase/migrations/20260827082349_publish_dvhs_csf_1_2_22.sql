-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.22';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '163664f712947e0ba4407eabf93b19d8c29f0990'
      OR v_existing.manifest_hash IS DISTINCT FROM '6e43c878f5bccdf34626739e9c7f40aeb7d23fac6b8e4926a7618272c2443f70'
      OR v_existing.source_tree IS DISTINCT FROM '904b744b4bcc840458c55657fcef981c689a7a6b'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:0d18f4f3c2fb1295e54864e73dca4a6ff5bf39003cf291270a3394684c84de25'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:b5fb7af5a1b79eb3b0a6782510ba2fb13be8e28da67e40da887d6d4e2f6e45cb'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:21a2917b1316067df7b988da169f27011d340b10918a83088ea0366df65dccb5'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.22","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.22/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260827020000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.22"}'::jsonb
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
      '1.2.22',
      'published',
      '## 1.2.22 - 2026-08-27

- Keep the opaque imported-profile cleanup cursor when a Server Action response
  is interrupted, so retrying resumes the same bounded page instead of starting
  over at earlier conflicts.
',
      '163664f712947e0ba4407eabf93b19d8c29f0990',
      '6e43c878f5bccdf34626739e9c7f40aeb7d23fac6b8e4926a7618272c2443f70',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '904b744b4bcc840458c55657fcef981c689a7a6b',
      'sha256:0d18f4f3c2fb1295e54864e73dca4a6ff5bf39003cf291270a3394684c84de25',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:b5fb7af5a1b79eb3b0a6782510ba2fb13be8e28da67e40da887d6d4e2f6e45cb',
      'sha256:21a2917b1316067df7b988da169f27011d340b10918a83088ea0366df65dccb5',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.22","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.22/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260827020000',
      '{"minimum":"1.1.0","maximum":"1.2.22"}'::jsonb,
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
