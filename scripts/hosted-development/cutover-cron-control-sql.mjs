import {
  maintenanceCatalogQuery,
  maintenanceLedgerQuery,
  maintenanceTarget,
} from "../production/maintenance-preflight.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import {
  developmentQuery,
  selectDevelopmentMaintenanceLedger,
} from "./cutover-database.mjs";
import { requireCondition } from "./cutover-authority.mjs";

export const development729Digest =
  "5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c";
const definitions = [
  [
    "process-automatic-check-ins",
    "* * * * *",
    "6288e4a0a6191a2f54ca14869c2866455b8cb00f13b1cfaa63342b1d292d9877",
  ],
  [
    "process-automatic-check-outs",
    "* * * * *",
    "0f8aee4a766ab64fe96c72650fbe7bf4f333138fdea5d970467fc654bfbfcb99",
  ],
  [
    "process-project-statuses",
    "*/5 * * * *",
    "74a2c6e669213519e301628302d4a5e47faf4b2228d55ec577192af284e47e24",
  ],
  [
    "retain-cron-execution-history",
    "17 * * * *",
    "ceb9e5aa2af89cd9a7878982b01f7bed511e6aab839efdb9d1e51f2f538944c5",
  ],
];
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function validateDevelopmentCronJobs(jobs) {
  requireCondition(
    Array.isArray(jobs) && jobs.length === 4,
    "The reviewed Development cron inventory must contain exactly four jobs.",
  );
  const sorted = [...jobs].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)),
  );
  requireCondition(
    new Set(sorted.map((job) => job.id)).size === 4,
    "Development cron identities are ambiguous.",
  );
  return sorted.map((job, index) => {
    const [name, schedule, commandSha256] = definitions[index];
    requireCondition(
      Number.isSafeInteger(job.id) &&
        job.id > 0 &&
        job.name === name &&
        job.schedule === schedule &&
        job.commandSha256 === commandSha256 &&
        job.owner === "postgres" &&
        job.database === "postgres" &&
        typeof job.active === "boolean",
      "Development cron identity, owner, schedule or command differs from its reviewed inventory.",
    );
    return {
      id: job.id,
      name,
      schedule,
      active: job.active,
      owner: "postgres",
      database: "postgres",
      commandSha256,
    };
  });
}

export const developmentCronInventorySql = `(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',jobid,'name',jobname,'schedule',schedule,'active',active,
 'owner',username,'database',database,
 'commandSha256',encode(extensions.digest(command,'sha256'),'hex')) ORDER BY jobname),'[]'::jsonb) FROM cron.job)`;
export const developmentCronBlockedSql = `EXISTS (
 SELECT 1 FROM pg_catalog.pg_roles role, unnest(role.rolconfig) setting
 WHERE role.rolname='authenticator' AND setting LIKE 'pgrst.app_settings.maintenance_write_block=%'
 AND setting<>'pgrst.app_settings.maintenance_write_block=off') OR EXISTS (
 SELECT 1 FROM pg_catalog.pg_db_role_setting role, unnest(role.setconfig) setting
 WHERE role.setrole='authenticator'::regrole
 AND role.setdatabase IN (0,(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
 AND setting LIKE 'pgrst.app_settings.maintenance_write_block=%'
 AND setting<>'pgrst.app_settings.maintenance_write_block=off')`;

export const developmentCronSnapshotQuery = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT json_build_object('cronSnapshot',${developmentCronInventorySql},
 'blocked',(${developmentCronBlockedSql}),
 'runningCron',(SELECT count(*) FROM cron.job_run_details WHERE status='running'));
COMMIT;`;

export function readDevelopmentCronSnapshot(config, query = developmentQuery) {
  const value = JSON.parse(
    query(config.databaseUrl, developmentCronSnapshotQuery),
  );
  requireCondition(
    value.blocked === false &&
      Number.isSafeInteger(value.runningCron) &&
      value.runningCron >= 0,
    "Cron control requires the unchanged Development application with its request guard inactive.",
  );
  return {
    jobs: validateDevelopmentCronJobs(value.cronSnapshot),
    runningCron: value.runningCron,
  };
}

export function reviewedDevelopmentCronLedger(
  config,
  query = developmentQuery,
) {
  const target = maintenanceTarget(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  const versions = selectDevelopmentMaintenanceLedger(
    target,
    applied,
    "before",
  );
  requireCondition(
    target.length === 739 &&
      ledgerDigest(target) ===
        "ddbe6830413c102faa86397712a191537598203ba7e357c6034856f438afb0a4" &&
      versions.length === 729 &&
      ledgerDigest(versions) === development729Digest,
    "The four-job operation accepts only the exact reviewed Development 729 history and 739 target.",
  );
  return versions;
}

export function developmentCronChangeSql(versions, before, after, operation) {
  requireCondition(
    versions.length === 729 &&
      ledgerDigest(versions) === development729Digest &&
      ["pause", "resume"].includes(operation),
    "Cron mutation is not bound to the reviewed Development history.",
  );
  before = validateDevelopmentCronJobs(before);
  after = validateDevelopmentCronJobs(after);
  requireCondition(
    before.every(
      (job, index) =>
        JSON.stringify({ ...job, active: after[index].active }) ===
        JSON.stringify(after[index]),
    ) &&
      (operation !== "pause" || after.every((job) => !job.active)),
    "Cron mutation may change only reviewed active flags.",
  );
  const catalog = maintenanceCatalogQuery(versions).trim().replace(/;$/u, "");
  const common = `(SELECT array_agg(version::text ORDER BY version) FROM supabase_migrations.schema_migrations)
 IS NOT DISTINCT FROM ARRAY[${versions.map(literal).join(",")}]::text[]
 AND (${catalog})=1 AND NOT (${developmentCronBlockedSql})
 AND NOT EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls WHERE workbook_refresh IS NOT FALSE OR import_commit IS NOT FALSE OR communications IS NOT FALSE OR scheduled_post_publisher IS NOT FALSE OR publication_notifications IS NOT FALSE)
 AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_publication_notification_deliveries WHERE status='processing' AND lease_expires_at>now())`;
  const assertion = (
    jobs,
  ) => `SELECT (${common}) AND ${developmentCronInventorySql}=${literal(JSON.stringify(jobs))}::jsonb AS valid
\\gset
\\if :valid
\\else
 SELECT 1 / 0 AS development_cron_guard_failed;
\\endif`;
  const activeCase = `CASE jobname ${after.map((job) => `WHEN ${literal(job.name)} THEN ${job.active}`).join(" ")} END`;
  return `BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s';
SELECT pg_catalog.pg_advisory_xact_lock(592042,1);
SELECT pg_catalog.pg_advisory_xact_lock(592043,1);
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE;
LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE;
${assertion(before)}
DO $development_cron_flags$
DECLARE job record;
BEGIN
 FOR job IN SELECT jobid,(${activeCase}) AS desired FROM cron.job
  WHERE active IS DISTINCT FROM (${activeCase}) ORDER BY jobname
 LOOP
  PERFORM cron.alter_job(job.jobid,active:=job.desired);
 END LOOP;
END;
$development_cron_flags$;
${assertion(after)}
COMMIT;
SELECT 'development-cron-${operation}-committed';`;
}
