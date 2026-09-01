-- Report only active import approval batches as worker backlog.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_get_worker_alert_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'communicationBacklogOlderThanFiveMinutes', (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.state = 'queued'
        AND attempt.available_at
          <= pg_catalog.statement_timestamp() - interval '5 minutes'
    ),
    'unresolvedImportBatches', (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_import_approval_batches AS batch
      WHERE batch.status IN ('queued', 'running')
        AND batch.updated_at
          <= pg_catalog.statement_timestamp() - interval '5 minutes'
    ),
    'blockedImportCommits', (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_import_commit_queue AS queue
      WHERE queue.status IN ('blocked', 'failed')
    )
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_get_worker_alert_snapshot()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_get_worker_alert_snapshot()
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_get_worker_alert_snapshot() IS
  'Returns aggregate active CSF worker alert counts only. Terminal partial batches do not remain in the backlog.';

COMMIT;
