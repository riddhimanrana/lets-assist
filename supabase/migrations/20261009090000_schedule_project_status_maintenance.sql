-- Schedule published project status maintenance.
-- public.process_projects() advances published projects from upcoming to
-- in-progress to completed and records app_private.project_schedule_health,
-- but no migration scheduled it. The health check treats a run older than
-- 15 minutes as stale, so the job runs every five minutes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Safely clear an existing job of the same name to prevent duplicates
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job') THEN
        PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'process-project-statuses';
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore in environments where cron schema is present but locked
END $$;

-- Register the cron job. It runs in this database as the migration owner,
-- which owns public.process_projects() and may execute it.
SELECT cron.schedule('process-project-statuses', '*/5 * * * *', 'SELECT public.process_projects()');

-- A maintenance window keeps every database job stopped and verifies that
-- posture again after its migrations apply. Join that hold instead of ending
-- it: when no other job is active, leave this one paused for the reviewed
-- step that restores the other jobs.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE active AND jobname <> 'process-project-statuses') THEN
        PERFORM cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'process-project-statuses';
    END IF;
END $$;

COMMIT;
