-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.82';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM 'f35e6b5a4b5be8036f9a8ff13175f8a978efc96f'
      OR v_existing.manifest_hash IS DISTINCT FROM '6d7521d29f6bc834a6f0e5b1fd3bfa9a05c64dfee674d4507a84cd209fd0007d'
      OR v_existing.source_tree IS DISTINCT FROM '58c52571880f4ac6e79cbe4d30b7c27820c54869'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:787ee9727554c049fa2bb22a107e8cfdef5ab1e532274b181ac7e01e36b84d28'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:79942376c77f3cbf5fed3d0500f60ad8fabf336a6d6f4290087fbd3e32f21604'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.82","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.82/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260928025013'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.82"}'::jsonb
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
      '1.2.82',
      'published',
      '## 1.2.82

Unsubmit now explains when a Sheet export has started and directs members to edit the claim or ask an officer for help. Queued exports that have never been attempted can be cancelled by Unsubmit after the platform migration is applied.
',
      'f35e6b5a4b5be8036f9a8ff13175f8a978efc96f',
      '6d7521d29f6bc834a6f0e5b1fd3bfa9a05c64dfee674d4507a84cd209fd0007d',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '58c52571880f4ac6e79cbe4d30b7c27820c54869',
      'sha256:787ee9727554c049fa2bb22a107e8cfdef5ab1e532274b181ac7e01e36b84d28',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:79942376c77f3cbf5fed3d0500f60ad8fabf336a6d6f4290087fbd3e32f21604',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.82","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.82/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260928025013',
      '{"minimum":"1.1.0","maximum":"1.2.82"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.82',
      code_reference = 'f35e6b5a4b5be8036f9a8ff13175f8a978efc96f',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.81'
    AND code_reference = '613ebefecc02cfd03b1dc4f4f1dc70348461fd5e';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.82'
      AND code_reference = 'f35e6b5a4b5be8036f9a8ff13175f8a978efc96f'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
