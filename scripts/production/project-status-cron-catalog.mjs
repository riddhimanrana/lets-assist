// Migration 20261009090000 schedules project status maintenance. The catalog
// pins the job's identity, cadence, command and owner. It does not pin
// `active`: a maintenance window holds the job paused, and runtime restores it.
export function projectStatusCronCatalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND (SELECT count(*) = 1 FROM cron.job
      WHERE jobname = 'process-project-statuses'
        AND schedule = '*/5 * * * *'
        AND username = 'postgres' AND database = current_database()
        AND command = 'SELECT public.process_projects()')
    AND pg_catalog.has_function_privilege(
      'postgres', 'public.process_projects()', 'EXECUTE')
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
