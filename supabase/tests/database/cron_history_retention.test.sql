BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(8);

SELECT is((SELECT count(*) FROM cron.job WHERE jobname = 'retain-cron-execution-history' AND active AND schedule = '17 * * * *'), 1::bigint, 'One hourly retention job is active');

-- All changes, including replacement fixtures, roll back after this test.
DELETE FROM cron.job_run_details;
INSERT INTO cron.job_run_details (runid, status, end_time)
VALUES (-1, 'succeeded', now() - interval '29 days'),
       (-2, 'failed', now() - interval '89 days'),
       (-3, 'running', NULL),
       (-4, 'failed', now() - interval '91 days'),
       (-5, 'succeeded', now() - interval '31 days');
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retain-cron-execution-history'); END $$;
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid = -1), 1::bigint, 'Recent success remains');
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid = -2), 1::bigint, 'Failures remain for ninety days');
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid = -3), 1::bigint, 'Running execution remains');
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid IN (-4,-5)), 0::bigint, 'Expired completed executions are removed');

INSERT INTO cron.job_run_details (runid, status, end_time)
SELECT -100000 - n, 'succeeded', now() - interval '31 days' FROM generate_series(1,50002) n;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retain-cron-execution-history'); END $$;
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid < -100000), 2::bigint, 'Each invocation removes at most fifty thousand logs');
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retain-cron-execution-history'); END $$;
SELECT is((SELECT count(*) FROM cron.job_run_details WHERE runid < -100000), 0::bigint, 'Next invocation drains the remainder');
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retain-cron-execution-history'); END $$;
SELECT is((SELECT count(*) FROM cron.job_run_details), 3::bigint, 'Repeated cleanup preserves retained executions');
SELECT * FROM finish();
ROLLBACK;
