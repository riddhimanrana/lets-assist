-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.80';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'a294ee5b7cf5a9a0202aed0f26a870d8289971e9'
      OR v_existing.manifest_hash IS DISTINCT FROM 'fb07a7e82b087ded5fc58764f2f914f30e8761d7610614d3dfdb20b599a30506'
      OR v_existing.source_tree IS DISTINCT FROM '9d805e8b5bf158ea232e999bf304e3ad3ac5358b'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:08b8c854fda4e3abc3bde0822cd7b667a59ebaf5ac68098632d251e7a673c949'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:d6bffe02ae20d3902d0a83164bfbf0d672ae20b6a18997a1c4ee47a1aa0e650b'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.80","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.80/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260924095624'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.80"}'::jsonb
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
      '1.2.80',
      'published',
      '## 1.2.80

Class activity forms let officers select All classes in the same semester. Announcement previews show semester membership and eligible recipients separately, with reasons for exclusions. New announcements can reach saved member profile contacts without requiring a connected account, while preserving opt-outs and delivery checks.

Activity emails use Geist with an email-safe fallback and a compact, aligned layout. Additional signup links have separate label and address rows on phones.

Class import recovery buttons submit the selected decision and show the saved receipt. Previously, Leave out and Retry import did not submit their forms.

Point progress uses the app theme, with solid approved credit and lighter submitted credit. The shared shadcn Calendar keeps event markers visible on selected days and fits narrow screens.

The proof picker shows accepted file formats inside Add proof. Size errors appear when needed. Submission forms omit the repeated semester and proof captions, and explain how the selected activity points count toward the service requirement.
',
      'a294ee5b7cf5a9a0202aed0f26a870d8289971e9',
      'fb07a7e82b087ded5fc58764f2f914f30e8761d7610614d3dfdb20b599a30506',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '9d805e8b5bf158ea232e999bf304e3ad3ac5358b',
      'sha256:08b8c854fda4e3abc3bde0822cd7b667a59ebaf5ac68098632d251e7a673c949',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:d6bffe02ae20d3902d0a83164bfbf0d672ae20b6a18997a1c4ee47a1aa0e650b',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.80","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.80/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260924095624',
      '{"minimum":"1.1.0","maximum":"1.2.80"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.80',
      code_reference = 'a294ee5b7cf5a9a0202aed0f26a870d8289971e9',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.79'
    AND code_reference = 'e72e343e44d826747cc13443a6a64fa0b5c9da3e';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.80'
      AND code_reference = 'a294ee5b7cf5a9a0202aed0f26a870d8289971e9'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
