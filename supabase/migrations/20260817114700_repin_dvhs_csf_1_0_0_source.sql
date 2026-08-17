-- Repin the not-yet-released DVHS CSF 1.0.0 attestation after the final
-- name-only historical identity safeguard merged to the private main branch.

BEGIN;

DO $$
DECLARE
  v_release public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_release
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.0.0'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DVHS CSF 1.0.0 must be published before its source attestation is repinned.';
  END IF;

  IF v_release.status IS DISTINCT FROM 'published'
    OR v_release.commit_sha NOT IN (
      'a55c10d68c04fedd00614bcfdcd6230f17c2d526',
      'c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa'
    )
    OR v_release.manifest_hash IS DISTINCT FROM '7334038cb6519e1732d9ac9ba0111f0ae41cfef2861c36595be975ba60f95534'
    OR v_release.rollout_percentage IS DISTINCT FROM 0
    OR v_release.compatibility_contract IS DISTINCT FROM jsonb_build_object(
      'host', 'lets-assist',
      'minimumHostVersion', '1.0.0',
      'automaticUpdate', false
    ) THEN
    RAISE EXCEPTION 'DVHS CSF 1.0.0 does not match the reviewed prelaunch attestation.';
  END IF;
END;
$$;

-- Published release metadata remains immutable to every runtime role. This
-- forward migration is the sole audited prelaunch correction path: the exact
-- old attestation was locked above, and the trigger is restored in the same
-- transaction (so any failure rolls the temporary DDL back as well).
ALTER TABLE public.plugin_versions
  DISABLE TRIGGER plugin_versions_enforce_immutable_release;

UPDATE public.plugin_versions
SET commit_sha = 'c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa'
WHERE plugin_key = 'dvhs-csf'
  AND version = '1.0.0'
  AND commit_sha = 'a55c10d68c04fedd00614bcfdcd6230f17c2d526';

ALTER TABLE public.plugin_versions
  ENABLE TRIGGER plugin_versions_enforce_immutable_release;

UPDATE public.plugins
SET code_reference = 'c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa',
    updated_at = now()
WHERE key = 'dvhs-csf'
  AND code_reference IN (
    'a55c10d68c04fedd00614bcfdcd6230f17c2d526',
    'c8fe3d41e5ba40967b8f0fa9bb2681fe05b2e6aa'
  );

COMMIT;
