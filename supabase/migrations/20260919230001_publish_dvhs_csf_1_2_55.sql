-- Publish a signed private plugin release without changing organization installs.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.2.55';

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM '1888ca808a2c9a532098b3ea3ae5dd13eb300150'
      OR v_existing.manifest_hash IS DISTINCT FROM 'f8e86aa327e2d3c587500a7e1aaaadb1f844e795231011ca8619db13dda78a90'
      OR v_existing.source_tree IS DISTINCT FROM '5597507faf429ac699aca1259db037378226e851'
      OR v_existing.content_digest IS DISTINCT FROM 'sha256:bdedc30084677c671cab767a79b6defadbc65a0af811a5bc638fe3cf0d3db504'
      OR v_existing.release_inputs IS DISTINCT FROM '["plugins/dvhs-csf"]'::jsonb
      OR v_existing.build_digest IS DISTINCT FROM NULL
      OR v_existing.sbom_digest IS DISTINCT FROM 'sha256:3728abcf4b23c94a4385743b3fbed17d9b4b753f0e15f642379027b8673b87fe'
      OR v_existing.signer_identity IS DISTINCT FROM '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.55","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.55/release-manifest.sigstore.json"}'::jsonb
      OR v_existing.host_api_range IS DISTINCT FROM '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM 1
      OR v_existing.required_platform_schema_version IS DISTINCT FROM '20260919230000'
      OR v_existing.supported_install_contracts IS DISTINCT FROM '{"minimum":"1.1.0","maximum":"1.2.55"}'::jsonb
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
      '1.2.55',
      'published',
      '## 1.2.55

- Give each post-image mutation its own Storage path generation so an expired cleanup worker cannot delete a later restored image.
- Let authorized organization teardown cancel unfinished image restore preparations before it drains preserved cleanup work.
',
      '1888ca808a2c9a532098b3ea3ae5dd13eb300150',
      'f8e86aa327e2d3c587500a7e1aaaadb1f844e795231011ca8619db13dda78a90',
      '{"host":"lets-assist","automaticUpdate":false}'::jsonb,
      0,
      '5597507faf429ac699aca1259db037378226e851',
      'sha256:bdedc30084677c671cab767a79b6defadbc65a0af811a5bc638fe3cf0d3db504',
      '["plugins/dvhs-csf"]'::jsonb,
      NULL,
      'sha256:3728abcf4b23c94a4385743b3fbed17d9b4b753f0e15f642379027b8673b87fe',
      '{"identity":"https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.55","issuer":"https://token.actions.githubusercontent.com","attestationRef":"github-release:dvhs-csf/v1.2.55/release-manifest.sigstore.json"}'::jsonb,
      '{"minimum":"1.0.0","maximum":"1.0.0"}'::jsonb,
      1,
      '20260919230000',
      '{"minimum":"1.1.0","maximum":"1.2.55"}'::jsonb,
      'embedded',
      now()
    );
  END IF;

  UPDATE public.plugins
  SET latest_version = '1.2.55',
      code_reference = '1888ca808a2c9a532098b3ea3ae5dd13eb300150',
      updated_at = now()
  WHERE key = 'dvhs-csf'
    AND latest_version = '1.2.54'
    AND code_reference = 'c7274ecd602ed499f008b966741c7f704dd9cb11';

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = 'dvhs-csf'
      AND latest_version = '1.2.55'
      AND code_reference = '1888ca808a2c9a532098b3ea3ae5dd13eb300150'
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;
END;
$$;

COMMIT;
