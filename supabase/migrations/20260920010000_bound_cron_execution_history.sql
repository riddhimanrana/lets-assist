-- Retain successful cron execution logs for 30 days and failures for 90 days.
-- Drain old logs in bounded batches without touching application audit records.
SELECT cron.schedule(
  'retain-cron-execution-history',
  '17 * * * *',
  $job$
  SET statement_timeout = '30s';
  SET lock_timeout = '2s';
  WITH expired AS (
    SELECT runid
    FROM cron.job_run_details
    WHERE (status = 'succeeded' AND end_time < now() - interval '30 days')
       OR (status = 'failed' AND end_time < now() - interval '90 days')
    ORDER BY runid
    LIMIT 50000
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM cron.job_run_details AS history
  USING expired
  WHERE history.runid = expired.runid;
  $job$
);
