BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(6);

SELECT is(
  (SELECT count(*) FROM cron.job WHERE jobname = 'process-project-statuses'),
  1::bigint,
  'Exactly one project status maintenance job is registered'
);
SELECT is(
  (SELECT count(*) FROM cron.job
   WHERE jobname = 'process-project-statuses'
     AND active AND schedule = '*/5 * * * *'
     AND command = 'SELECT public.process_projects()'
     AND username = 'postgres' AND database = current_database()),
  1::bigint,
  'Status maintenance runs every five minutes as the migration owner'
);
SELECT is(
  (SELECT count(*) FROM cron.job
   WHERE jobname <> 'process-project-statuses'
     AND regexp_replace(lower(command), '[[:space:];]', '', 'g') = 'selectpublic.process_projects()'),
  0::bigint,
  'No second job duplicates status maintenance'
);
SELECT ok(
  has_function_privilege('postgres', 'public.process_projects()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.process_projects()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.process_projects()', 'EXECUTE'),
  'The job owner can run maintenance and browser roles cannot'
);

-- All changes roll back after this test.
DELETE FROM app_private.project_schedule_health;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'process-project-statuses'); END $$;
SELECT is(
  (SELECT count(*) FROM app_private.project_schedule_health WHERE checked_at >= now()),
  1::bigint,
  'The scheduled command records a fresh maintenance run'
);
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'process-project-statuses'); END $$;
SELECT is(
  (SELECT count(*) FROM app_private.project_schedule_health),
  1::bigint,
  'A repeated run keeps one health row'
);
SELECT * FROM finish();
ROLLBACK;
