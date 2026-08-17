-- Publish the first production DVHS CSF plugin contract only after its exact
-- private-repository source and manifest bytes were frozen. Automatic updates
-- remain disabled; installation and upgrades stay explicit organization acts.

BEGIN;

DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf' AND version = '1.0.0';

  IF FOUND AND (
    v_existing.status IS DISTINCT FROM 'published'
    OR v_existing.commit_sha IS DISTINCT FROM 'a55c10d68c04fedd00614bcfdcd6230f17c2d526'
    OR v_existing.manifest_hash IS DISTINCT FROM '7334038cb6519e1732d9ac9ba0111f0ae41cfef2861c36595be975ba60f95534'
    OR v_existing.rollout_percentage IS DISTINCT FROM 0
    OR v_existing.compatibility_contract IS DISTINCT FROM jsonb_build_object(
      'host', 'lets-assist',
      'minimumHostVersion', '1.0.0',
      'automaticUpdate', false
    )
  ) THEN
    RAISE EXCEPTION 'The existing DVHS CSF 1.0.0 release does not match the reviewed source attestation.';
  END IF;
END;
$$;

INSERT INTO public.plugin_versions (
  plugin_key,
  version,
  status,
  changelog,
  commit_sha,
  manifest_hash,
  compatibility_contract,
  rollout_percentage,
  published_at
)
VALUES (
  'dvhs-csf',
  '1.0.0',
  'published',
  'Class-first DVHS CSF production release with permanent class identity, term-aware operations, contextual imports, safe public projections, communications readiness, and audited review workflows.',
  'a55c10d68c04fedd00614bcfdcd6230f17c2d526',
  '7334038cb6519e1732d9ac9ba0111f0ae41cfef2861c36595be975ba60f95534',
  jsonb_build_object(
    'host', 'lets-assist',
    'minimumHostVersion', '1.0.0',
    'automaticUpdate', false
  ),
  0,
  now()
)
ON CONFLICT (plugin_key, version) DO NOTHING;

UPDATE public.plugins
SET latest_version = '1.0.0',
    code_reference = 'a55c10d68c04fedd00614bcfdcd6230f17c2d526',
    updated_at = now()
WHERE key = 'dvhs-csf';

COMMIT;
