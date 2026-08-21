-- Preserve the append-only ledger entry created when the signed 1.2.1 release
-- was published to hosted Development. The preceding release migration owns
-- the insert. This reconciliation step fails closed if that identity differs.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions
    WHERE plugin_key = 'dvhs-csf'
      AND version = '1.2.1'
      AND status = 'published'
      AND commit_sha = '37d0dbd414a64bf53076fe30450b38b1e90a4ec9'
      AND build_digest = 'sha256:dee24c38f33f33de934eeb1815d2b07daeb78135fb4b4a13f3cf4855497de15b'
      AND runtime_profile = 'application'
      AND rollout_percentage = 0
  ) THEN
    RAISE EXCEPTION 'Signed DVHS CSF 1.2.1 release identity is missing or divergent';
  END IF;
END;
$$;

COMMIT;
