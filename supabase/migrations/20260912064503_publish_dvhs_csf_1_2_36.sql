-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.36';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '20141fb766409d3b9b493128a8cc6c4a6710a20d'
      OR v_existing.manifest_hash IS DISTINCT FROM 'b211c405c51146018422db73246612f9dacfe153cb6eb514b53f3e1ce28accaa'
      OR v_existing.source_tree IS DISTINCT FROM '5a5dbfbffc080cec7b6cc7569c34de1660218abc'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:638026a8f0007e945bfca8d9232952f028c34e6fb2cbe34d16df290043943844'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:09dd0cad28d77ea04c1a6b351f30c22e060b2552e55e8422ac4a78605f358666'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.36","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.36/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260912015608'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.36"}'::jsonb
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
      '1.2.36',
      'published',
      '## 1.2.36

- Let staff use their own verified profile in member Point submissions without requiring queue-review access. Keep other profiles private.
- Show submitted application corrections in the staff review panel and let authorized reviewers record their decision. Application approval remains a separate action.
',
      '20141fb766409d3b9b493128a8cc6c4a6710a20d',
      'b211c405c51146018422db73246612f9dacfe153cb6eb514b53f3e1ce28accaa',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '5a5dbfbffc080cec7b6cc7569c34de1660218abc',
      'sha256:638026a8f0007e945bfca8d9232952f028c34e6fb2cbe34d16df290043943844',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:09dd0cad28d77ea04c1a6b351f30c22e060b2552e55e8422ac4a78605f358666',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.36","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.36/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260912015608',
      '{"minimum":"1.1.0","maximum":"1.2.36"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.36',
      code_reference = '20141fb766409d3b9b493128a8cc6c4a6710a20d',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.35'
    AND code_reference = '85fc9737fcc41049339163a92877d2605c551814';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.36'
      AND code_reference = '20141fb766409d3b9b493128a8cc6c4a6710a20d'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
