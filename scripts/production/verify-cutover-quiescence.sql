-- Fail closed unless database-scheduled writers are stopped before the
-- Production maintenance and schema-push window. This script is read-only and
-- emits no job names, commands, or credentials.

\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';

SELECT count(*) = 0 AS no_active_pg_cron_jobs
FROM cron.job
WHERE active
\gset

\if :no_active_pg_cron_jobs
  \echo 'PASS Q1: no active pg_cron schedules.'
\else
  \echo 'FAIL Q1: active pg_cron schedules remain.'
  SELECT 1 / 0 AS quiescence_check_failed;
\endif

SELECT count(*) = 0 AS no_running_pg_cron_jobs
FROM cron.job_run_details
WHERE status = 'running'
\gset

\if :no_running_pg_cron_jobs
  \echo 'PASS Q2: no pg_cron execution is still running.'
\else
  \echo 'FAIL Q2: a pg_cron execution is still running.'
  SELECT 1 / 0 AS quiescence_check_failed;
\endif

SELECT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = 'authenticator'
    AND 'default_transaction_read_only=on' = ANY (
      coalesce(rolconfig, ARRAY[]::text[])
    )
) AS application_write_block_active
\gset

\if :application_write_block_active
  \echo 'PASS Q3: the PostgREST application write block is active.'
\else
  \echo 'FAIL Q3: the PostgREST application write block is not active.'
  SELECT 1 / 0 AS quiescence_check_failed;
\endif

COMMIT;
