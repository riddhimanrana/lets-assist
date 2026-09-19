-- Distinguish deterministic attendance-window exclusions from malformed rows.
-- Both remain immutable, uncredited error rows in the preview. The distinction
-- lets officers commit independent verified rows without accepting an early or
-- late response, while malformed timestamps continue to block the manual gate.

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
  WITH preview AS (
    SELECT job.source_type
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.id = p_preview_job_id
      AND job.mode = 'preview'
  ),
  row_counts AS (
    SELECT
      pg_catalog.count(*) AS total,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'pending') AS pending,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'ambiguous') AS ambiguous,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'conflict') AS conflict,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'duplicate') AS duplicate,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'error') AS error,
      pg_catalog.count(*) FILTER (
        WHERE preview.source_type = 'meeting_attendance'
          AND import_row.import_status = 'error'
          AND (
            'This response arrived before attendance opened and cannot count.' = ANY(import_row.errors)
            OR 'This response arrived after attendance closed and cannot count.' = ANY(import_row.errors)
          )
      ) AS attendance_window_excluded,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'superseded') AS superseded,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status IN ('created', 'updated')
      ) AS committed,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'skipped') AS skipped,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.cohort_id IS NULL
      ) AS pending_missing_cohort,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.term_id IS NULL
      ) AS pending_missing_term,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NULL
          AND (
            preview.source_type = 'application_responses'
            OR (
              preview.source_type = 'class_history'
              AND (
                NOT plugin_data.csf_class_history_has_stable_source_key(
                  import_row.normalized_data
                )
                OR plugin_data.csf_class_history_source_key_requires_review(
                  import_row.organization_id,
                  import_row.id
                )
              )
            )
          )
      ) AS pending_missing_match,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NULL
          AND preview.source_type = 'class_history'
          AND NOT plugin_data.csf_class_history_has_stable_source_key(
            import_row.normalized_data
          )
      ) AS pending_missing_source_key,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'in_flight'
      ) AS in_flight,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'unknown'
      ) AS unknown_outcome,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'historical_unknown'
      ) AS historical_unknown,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'failed'
          AND import_row.import_status = 'error'
      ) AS failed_awaiting_decision
    FROM plugin_data.csf_sheet_import_rows AS import_row
    CROSS JOIN preview
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
    'attendanceWindowExcluded', counts.attendance_window_excluded,
    'superseded', counts.superseded,
    'committed', counts.committed,
    'skipped', counts.skipped,
    'pendingMissingCohort', counts.pending_missing_cohort,
    'pendingMissingTerm', counts.pending_missing_term,
    'pendingMissingMatch', counts.pending_missing_match,
    'pendingMissingSourceKey', counts.pending_missing_source_key,
    'inFlight', counts.in_flight,
    'unknownOutcome', counts.unknown_outcome,
    'historicalUnknown', counts.historical_unknown,
    'failedAwaitingDecision', counts.failed_awaiting_decision,
    'commitState', coalesce(commit.state, 'none'),
    'commitJobId', commit.id
  )
  FROM row_counts AS counts
  LEFT JOIN commit_state AS commit ON true;
$function$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid) IS
  'Returns service-only whole-preview counts, including deterministic meeting attendance window exclusions, and the durable commit state.';
