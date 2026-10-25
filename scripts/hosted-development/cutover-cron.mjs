import { maintenanceLedgerQuery } from "../production/maintenance-preflight.mjs";
import {
  bootstrapPlan,
  bootstrapVerificationSql,
} from "./cutover-bootstrap.mjs";
import { developmentQuery, validateDatabaseUrl } from "./cutover-database.mjs";
import { requireCondition } from "./cutover-authority.mjs";

export function bootstrapCronPauseSql(versions) {
  const verification = bootstrapVerificationSql(versions);
  const inactive = "NOT EXISTS (SELECT 1 FROM cron.job WHERE active)";
  requireCondition(
    verification.split(inactive).length === 2,
    "The bootstrap cron posture needs review.",
  );
  return `BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
SELECT pg_catalog.pg_advisory_xact_lock(592042,1);
SELECT pg_catalog.pg_advisory_xact_lock(592043,1);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE;
LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE;
${verification.replace(inactive, "true")}
DO $pause_development_cron$
DECLARE job record;
BEGIN
  IF (SELECT count(*) FROM cron.job) <> 3 OR EXISTS (
    SELECT 1 FROM cron.job WHERE username IS DISTINCT FROM 'postgres'
      OR database IS DISTINCT FROM current_database()
      OR NOT (
        (jobname='process-automatic-check-ins' AND schedule='* * * * *'
          AND command='SELECT public.process_automatic_check_ins()')
        OR (jobname='process-automatic-check-outs' AND schedule='* * * * *'
          AND command='SELECT public.process_automatic_check_outs()')
        OR jobname='retain-cron-execution-history'
      )
  ) OR (SELECT count(DISTINCT jobname) FROM cron.job) <> 3 THEN
    RAISE EXCEPTION 'Development cron inventory differs from the reviewed baseline';
  END IF;
  FOR job IN SELECT jobid FROM cron.job WHERE active AND jobname IN (
    'process-automatic-check-ins', 'process-automatic-check-outs',
    'retain-cron-execution-history'
  ) LOOP
    PERFORM cron.alter_job(job.jobid, active:=false);
  END LOOP;
END;
$pause_development_cron$;
${verification}
COMMIT;
SELECT 'development-bootstrap-cron-paused';`;
}

export function pauseBootstrapCron(config, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  const plan = bootstrapPlan(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  requireCondition(
    [plan.before, plan.after].some(
      (expected) => JSON.stringify(expected) === JSON.stringify(applied),
    ),
    "Cron shutdown accepts only the exact bootstrap baseline.",
  );
  requireCondition(
    query(config.databaseUrl, bootstrapCronPauseSql(applied)) ===
      "development-bootstrap-cron-paused",
    "Development cron shutdown is unproven. Reconcile before continuing.",
  );
}
