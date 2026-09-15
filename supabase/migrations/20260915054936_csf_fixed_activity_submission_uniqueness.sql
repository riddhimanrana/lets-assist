-- Fixed awards remain unique after approval. Known repeatable modes retain their existing behavior.
BEGIN;

-- Refuse to proceed when rows already violate the tightened rule. Marking
-- awarded credit as duplicate is a staff decision, not a migration side effect.
DO $$
DECLARE
  v_groups integer;
BEGIN
  SELECT count(*)
  INTO v_groups
  FROM (
    SELECT 1
    FROM plugin_data.csf_point_submissions
    WHERE opportunity_id IS NOT NULL
      AND status NOT IN ('rejected', 'duplicate', 'withdrawn')
      AND (
        status <> 'approved'
        OR earning_rules_snapshot -> 'legacy' = 'true'::jsonb
        OR coalesce(earning_rules_snapshot ->> 'mode', '')
          NOT IN ('quantity', 'per_item', 'shifts', 'assessment')
      )
    GROUP BY organization_id, profile_id, term_id, opportunity_id
    HAVING count(*) > 1
  ) AS duplicates;
  IF v_groups > 0 THEN
    RAISE EXCEPTION
      '% member/activity group(s) hold more than one active single-award submission; review them before applying this migration.',
      v_groups;
  END IF;
END;
$$;

DROP INDEX plugin_data.csf_point_submissions_one_active_activity_claim_idx;
CREATE UNIQUE INDEX csf_point_submissions_one_active_activity_claim_idx
  ON plugin_data.csf_point_submissions (organization_id, profile_id, term_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL
    AND status NOT IN ('rejected', 'duplicate', 'withdrawn')
    AND (
      status <> 'approved'
      OR earning_rules_snapshot -> 'legacy' = 'true'::jsonb
      OR coalesce(earning_rules_snapshot ->> 'mode', '')
        NOT IN ('quantity', 'per_item', 'shifts', 'assessment')
    );

COMMENT ON INDEX plugin_data.csf_point_submissions_one_active_activity_claim_idx IS
  'One unfinished submission per member and activity. Approved submissions leave the rule only when their snapshot mode is quantity, per_item, shifts, or assessment; fixed, legacy, unknown, and absent modes stay single-claim.';

COMMIT;
