-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.10';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'c23b60674d29fa20b4b5138a8a717094ea00988e'
      OR v_existing.manifest_hash IS DISTINCT FROM '64fa765471cc1bb3169a04f1bf6657eab4a01c9c66b878f371265fd8d8ab003c'
      OR v_existing.source_tree IS DISTINCT FROM '9f6001f611e0488cecb0892ea6a6a3669f05c394'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:d381e8459687981ee4af1f3593b5218b95241f2aa8b7b763aa1840e3d5dc519e'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf","apps/csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM 'sha256:2ec767b3c4ce9e5d32072b3ad9f8064fe946ed2402a11fb7863d084f7c6f73ee'
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:63d6d5835685dcb4097d76327f013e68b3da489a9cef6dec1bc036d0c04c192f'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.10","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.10/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260824084735'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.10"}'::jsonb
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
      '1.2.10',
      'published',
      '## 1.2.10 - 2026-08-24

- Added optional member email when an activity is first published.
- Selected email by default for new and republished feed posts while leaving already-published edits unchecked.
- Allowed verified organization accounts without student profiles to hold adviser, teacher, and officer positions.
- Kept application-response import previews and saved sources separate from roster history imports.
- Kept communications setup compatible with the host-owned provider boundary.
',
      'c23b60674d29fa20b4b5138a8a717094ea00988e',
      '64fa765471cc1bb3169a04f1bf6657eab4a01c9c66b878f371265fd8d8ab003c',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '9f6001f611e0488cecb0892ea6a6a3669f05c394',
      'sha256:d381e8459687981ee4af1f3593b5218b95241f2aa8b7b763aa1840e3d5dc519e',
      '["plugins/dvhs-csf","apps/csf"]'::jsonb,
      'sha256:2ec767b3c4ce9e5d32072b3ad9f8064fe946ed2402a11fb7863d084f7c6f73ee',
      'sha256:63d6d5835685dcb4097d76327f013e68b3da489a9cef6dec1bc036d0c04c192f',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.10","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.10/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260824084735',
      '{"minimum":"1.1.0","maximum":"1.2.10"}'::jsonb,
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
