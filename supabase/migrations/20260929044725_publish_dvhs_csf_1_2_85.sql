-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.85';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d'
      OR v_existing.manifest_hash IS DISTINCT FROM '4fbf8536fe93bf9d7279f1bc91b22aaa339a422063b179830e3c3f80a657f039'
      OR v_existing.source_tree IS DISTINCT FROM 'f6cd9019d26787370df3453aea2f554af71c227c'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:4bca514172604a94ae73eb04f5e8ae337549d88a5ef36d44e3b48908b837c9c7'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:2d349c7a2dbe3f0a2fdeae64ef63da06ac6bcba956a23455657afdab7bff8b52'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.85","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.85/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260929044000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.85"}'::jsonb
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
      '1.2.85',
      'published',
      '## 1.2.85

Remove activity clears the activity list while preserving linked submissions, earned points, signups, and email history. Empty activities are permanently deleted. Archived activities no longer appear in the staff catalog.
',
      'a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d',
      '4fbf8536fe93bf9d7279f1bc91b22aaa339a422063b179830e3c3f80a657f039',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      'f6cd9019d26787370df3453aea2f554af71c227c',
      'sha256:4bca514172604a94ae73eb04f5e8ae337549d88a5ef36d44e3b48908b837c9c7',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:2d349c7a2dbe3f0a2fdeae64ef63da06ac6bcba956a23455657afdab7bff8b52',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.85","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.85/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260929044000',
      '{"minimum":"1.1.0","maximum":"1.2.85"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.85',
      code_reference = 'a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.84'
    AND code_reference = 'e4f229d8b1f8b1aebcd3f3a03fb552108bd11a4c';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.85'
      AND code_reference = 'a1d5836fb800ad4afef7cfbfc6ed4a5f63e23f3d'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
