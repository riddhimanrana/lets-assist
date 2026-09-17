-- Retired receipts created before the join-code projection could leave a
-- previously active code usable. Revoke those codes with their retention actor.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_class_join_codes AS code
    JOIN plugin_data.csf_retention_retired_cohorts AS retired
      ON retired.organization_id = code.organization_id
     AND retired.cohort_id = code.cohort_id
    JOIN plugin_data.csf_retention_runs AS run
      ON run.organization_id = retired.organization_id
     AND run.id = retired.run_id
    WHERE code.status = 'active'
      AND coalesce(run.committed_by, run.actor_user_id) IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A retired CSF class has an active code without a retention actor.';
  END IF;
END;
$$;

WITH revoked AS (
  UPDATE plugin_data.csf_class_join_codes AS code
  SET status = 'revoked',
      revoked_by = coalesce(run.committed_by, run.actor_user_id),
      revoked_at = now(),
      revoke_reason = 'Class retired by a completed retention operation.'
  FROM plugin_data.csf_retention_retired_cohorts AS retired
  JOIN plugin_data.csf_retention_runs AS run
    ON run.organization_id = retired.organization_id
   AND run.id = retired.run_id
  WHERE code.organization_id = retired.organization_id
    AND code.cohort_id = retired.cohort_id
    AND code.status = 'active'
  RETURNING code.organization_id, code.cohort_id, code.id AS code_id,
            code.revoked_by
)
INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id, actor_user_id, action, target_type, target_id,
  before_data, after_data, correlation_id, source_type, source_id, reason_code
)
SELECT revoked.organization_id, revoked.revoked_by,
       'class.join_code.revoked', 'csf_class_join_codes', revoked.code_id,
       jsonb_build_object('status', 'active'),
       jsonb_build_object('cohortId', revoked.cohort_id, 'status', 'revoked',
                          'backfilled', true),
       gen_random_uuid(), 'retention_run', retired.run_id::text,
       'class_retired_backfill'
FROM revoked
JOIN plugin_data.csf_retention_retired_cohorts AS retired
  ON retired.organization_id = revoked.organization_id
 AND retired.cohort_id = revoked.cohort_id;

COMMIT;
