-- One service-only projection replaces sixteen exact-count requests and the
-- separate commit-attempt lookup made for every import preview render.
CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_readiness(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH row_counts AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE import_row.import_status = 'pending') AS pending,
      count(*) FILTER (WHERE import_row.import_status = 'ambiguous') AS ambiguous,
      count(*) FILTER (WHERE import_row.import_status = 'conflict') AS conflict,
      count(*) FILTER (WHERE import_row.import_status = 'duplicate') AS duplicate,
      count(*) FILTER (WHERE import_row.import_status = 'error') AS error,
      count(*) FILTER (WHERE import_row.import_status = 'superseded') AS superseded,
      count(*) FILTER (
        WHERE import_row.import_status IN ('created', 'updated')
      ) AS committed,
      count(*) FILTER (WHERE import_row.import_status = 'skipped') AS skipped,
      count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.cohort_id IS NULL
      ) AS pending_missing_cohort,
      count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.term_id IS NULL
      ) AS pending_missing_term,
      count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NULL
      ) AS pending_missing_match,
      count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'in_flight'
      ) AS in_flight,
      count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'unknown'
      ) AS unknown_outcome,
      count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'historical_unknown'
      ) AS historical_unknown,
      count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'failed'
          AND import_row.import_status = 'error'
      ) AS failed_awaiting_decision
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
  ),
  commit_state AS (
    SELECT
      commit_job.id,
      CASE
        WHEN commit_job.status = 'completed' THEN 'completed'
        WHEN commit_job.status = 'cancelled' THEN 'cancelled'
        WHEN commit_job.status = 'partially_completed' THEN 'partially_completed'
        WHEN commit_job.status = 'failed' THEN 'failed'
        WHEN attempt.status = 'running'
          AND attempt.lease_expires_at > pg_catalog.now() THEN 'running'
        ELSE 'recoverable'
      END AS state
    FROM plugin_data.csf_sheet_import_jobs AS commit_job
    LEFT JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
      ON attempt.organization_id = commit_job.organization_id
     AND attempt.id = commit_job.active_commit_attempt_id
    WHERE commit_job.organization_id = p_organization_id
      AND commit_job.mode = 'commit'
      AND commit_job.preview_job_id = p_preview_job_id
    LIMIT 1
  )
  SELECT pg_catalog.jsonb_build_object(
    'previewJobId', p_preview_job_id,
    'total', counts.total,
    'pending', counts.pending,
    'ambiguous', counts.ambiguous,
    'conflict', counts.conflict,
    'duplicate', counts.duplicate,
    'error', counts.error,
    'superseded', counts.superseded,
    'committed', counts.committed,
    'skipped', counts.skipped,
    'pendingMissingCohort', counts.pending_missing_cohort,
    'pendingMissingTerm', counts.pending_missing_term,
    'pendingMissingMatch', counts.pending_missing_match,
    'inFlight', counts.in_flight,
    'unknownOutcome', counts.unknown_outcome,
    'historicalUnknown', counts.historical_unknown,
    'failedAwaitingDecision', counts.failed_awaiting_decision,
    'commitState', COALESCE(commit.state, 'none'),
    'commitJobId', commit.id
  )
  FROM row_counts AS counts
  LEFT JOIN commit_state AS commit ON true;
$function$;

COMMENT ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid) IS
  'Returns exact row-state counts and the current commit lease state for one organization-scoped CSF preview.';

REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  TO service_role;
