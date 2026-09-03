-- Count stalled CSF worker queues without returning tenant or student data.

CREATE FUNCTION plugin_data.csf_get_worker_alert_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'communicationBacklogOlderThanFiveMinutes', (
      SELECT count(*)
      FROM plugin_data.csf_communication_dispatch_attempts AS attempt
      WHERE attempt.state = 'queued'
        AND attempt.available_at <= statement_timestamp() - interval '5 minutes'
    ),
    'unresolvedImportBatches', (
      SELECT count(*)
      FROM plugin_data.csf_import_approval_batches AS batch
      WHERE batch.status <> 'completed'
        AND batch.updated_at <= statement_timestamp() - interval '5 minutes'
    ),
    'blockedImportCommits', (
      SELECT count(*)
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
  'Returns aggregate CSF worker alert counts only. Tenant, student, message, and import content never leave the database.';
