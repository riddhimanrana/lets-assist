import { execFileSync } from "node:child_process";
import {
  executeMaintenanceQuery,
  maintenanceLedgerQuery,
  maintenanceCatalogQuery,
  maintenancePostureQuery,
  maintenanceTarget,
  maintenanceVerificationQuery,
  selectMaintenanceLedger,
} from "../production/maintenance-preflight.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { acceptedCatalogQuery } from "../production/app-release-catalog.mjs";
import { reviewedDevelopmentVersions } from "../production/reconciliation-ledgers.mjs";
import {
  applicationRequestWriteFlagSql,
  settlePreexistingRequestTransactionsSql,
} from "../production/request-write-fence.mjs";
import { requireCondition, target } from "./cutover-authority.mjs";
import { databaseFailureCategory } from "./cutover-database-errors.mjs";

export function developmentQuery(url, sql, execute = execFileSync) {
  let category;
  try {
    return executeMaintenanceQuery(url, sql, (file, args, options) => {
      try {
        return execute(file, args, options);
      } catch (error) {
        category = databaseFailureCategory(error);
        throw error;
      }
    });
  } catch {
    requireCondition(
      false,
      `Development database operation failed${category ? ` (${category})` : ""}. Raw output was suppressed.`,
    );
  }
}

export function validateDatabaseUrl(value) {
  let url;
  let username;
  try {
    url = new URL(value);
    username = decodeURIComponent(url.username);
  } catch {
    /* Refuse below. */
  }
  requireCondition(
    url &&
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.password &&
      !url.hash &&
      url.pathname === "/postgres" &&
      (!url.port || ["5432", "6543"].includes(url.port)) &&
      ((url.hostname === `db.${target.database}.supabase.co` &&
        username === "postgres") ||
        (url.hostname.endsWith(".pooler.supabase.com") &&
          username === `postgres.${target.database}`)) &&
      [...url.searchParams.keys()].every((key) => key === "sslmode") &&
      url.searchParams.getAll("sslmode").length <= 1 &&
      (!url.searchParams.has("sslmode") ||
        ["require", "verify-ca", "verify-full"].includes(
          url.searchParams.get("sslmode"),
        )),
    "The database URI must name only the fixed Development database without connection overrides.",
  );
}

export function developmentDatabaseTransport(value) {
  validateDatabaseUrl(value);
  const url = new URL(value);
  if (url.hostname !== `db.${target.database}.supabase.co`) return value;
  // Development Connect verified this Session endpoint on 2026-10-19.
  // Select it before SQL; a failed operation must never acquire an implicit retry.
  url.hostname = "aws-0-us-west-1.pooler.supabase.com";
  url.port = "5432";
  url.username = `postgres.${target.database}`;
  return url.href;
}

const quiescenceStart =
  "  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE active)";
requireCondition(
  maintenancePostureQuery.split(quiescenceStart).length === 2,
  "The shared maintenance posture contract needs review.",
);
export const quiescencePredicate = `true${maintenancePostureQuery.slice(maintenancePostureQuery.indexOf(quiescenceStart))}`;
export const quiescenceQuery = `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT ${quiescencePredicate};
COMMIT;`;

export function verifyQuiescence(config, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  requireCondition(
    query(config.databaseUrl, quiescenceQuery) === "t",
    "Stop all database cron jobs and CSF workers, and drain their leases before preparation.",
  );
}

export function selectDevelopmentMaintenanceLedger(
  targetVersions,
  applied,
  mode,
) {
  if (
    mode === "before" &&
    targetVersions.length === 740 &&
    ledgerDigest(targetVersions) ===
      "073e908b7c1a0a2df12cfd133abe41d26cbd4ef751e9a39fc4a43528490249f7" &&
    Array.isArray(applied) &&
    applied.length === 729 &&
    ledgerDigest(applied) ===
      "5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c" &&
    JSON.stringify(applied) ===
      JSON.stringify(reviewedDevelopmentVersions(targetVersions))
  ) {
    acceptedCatalogQuery("", applied);
    return applied;
  }
  return selectMaintenanceLedger(targetVersions, applied, mode);
}

export function inspectDevelopmentDatabase(config, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  const targetVersions = maintenanceTarget(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  const versions = selectDevelopmentMaintenanceLedger(
    targetVersions,
    applied,
    "before",
  );
  const catalog = maintenanceCatalogQuery(versions).trim().replace(/;$/u, "");
  const posture = JSON.parse(
    query(
      config.databaseUrl,
      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s';
SELECT json_build_object(
 'inspectionLedger',(SELECT array_agg(version::text ORDER BY version) FROM supabase_migrations.schema_migrations)
   IS NOT DISTINCT FROM ARRAY[${versions.map((version) => `'${version.replaceAll("'", "''")}'`).join(",")}]::text[],
 'inspectionCatalog',(${catalog})=1,
 'activeCron',(SELECT count(*) FROM cron.job WHERE active),
 'runningCron',(SELECT count(*) FROM cron.job_run_details WHERE status='running'),
 'enabledControlRows',(SELECT count(*) FROM app_private.csf_release_worker_controls
   WHERE workbook_refresh IS NOT FALSE OR import_commit IS NOT FALSE OR communications IS NOT FALSE
     OR scheduled_post_publisher IS NOT FALSE OR publication_notifications IS NOT FALSE),
 'publicationLeases',(SELECT count(*) FROM plugin_data.csf_publication_notification_deliveries
   WHERE status='processing' AND lease_expires_at>now()));
COMMIT;`,
    ),
  );
  requireCondition(
    posture.inspectionLedger === true &&
      posture.inspectionCatalog === true &&
      [
        posture.activeCron,
        posture.runningCron,
        posture.enabledControlRows,
        posture.publicationLeases,
      ].every((value) => Number.isSafeInteger(value) && value >= 0),
    "Development inspection did not verify its accepted catalog and count-only posture.",
  );
  return {
    count: versions.length,
    head: versions.at(-1),
    digest: ledgerDigest(versions),
    catalog: "verified",
    databaseQuiescent: [
      posture.activeCron,
      posture.runningCron,
      posture.enabledControlRows,
      posture.publicationLeases,
    ].every((value) => value === 0),
    posture,
  };
}

export function verifyDevelopmentMaintenance(
  config,
  mode,
  query = developmentQuery,
) {
  validateDatabaseUrl(config.databaseUrl);
  const targetVersions = maintenanceTarget(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  const versions = selectDevelopmentMaintenanceLedger(
    targetVersions,
    applied,
    mode,
  );
  requireCondition(
    versions.includes("20260929051600"),
    "The reviewed request write-fence bootstrap must be applied before preparation.",
  );
  requireCondition(
    query(config.databaseUrl, maintenanceVerificationQuery(versions)) ===
      "maintenance-preflight-verified",
    "Development ledger, catalog or maintenance posture is not verified.",
  );
  return {
    count: versions.length,
    head: versions.at(-1),
    digest: ledgerDigest(versions),
    targetDigest: ledgerDigest(targetVersions),
    catalog: "verified",
    postgrest: "request-guard-configured",
  };
}

export const writeBlockSql = applicationRequestWriteFlagSql;

export function settlePreexistingRequests(config, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  query(config.databaseUrl, settlePreexistingRequestTransactionsSql);
}

export function setWriteBlock(config, enabled, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  query(config.databaseUrl, writeBlockSql(enabled));
}

export function retentionTransitionSql(versions, enabled) {
  if (!enabled)
    return "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='retain-cron-execution-history';";
  const catalog = acceptedCatalogQuery("", versions).trim().replace(/;$/u, "");
  const posture = maintenancePostureQuery.replace(
    "FROM cron.job WHERE active)",
    "FROM cron.job WHERE active AND jobname<>'retain-cron-execution-history')",
  );
  requireCondition(
    posture !== maintenancePostureQuery,
    "Cron posture contract needs review.",
  );
  return `BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=public,extensions;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
SELECT array_agg(version::text ORDER BY version) IS NOT DISTINCT FROM ARRAY[${versions.map((version) => `'${version}'`).join(",")}]::text[] AS valid
FROM supabase_migrations.schema_migrations \\gset
\\if :valid
\\else
SELECT 1/0;
\\endif
SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='retain-cron-execution-history';
SELECT (${catalog})=1 AS valid \\gset
\\if :valid
\\else
SELECT 1/0;
\\endif
${posture.replace("current_setting('transaction_read_only') = 'on'", "true")} \\gset
\\if :valid
\\else
SELECT 1/0;
\\endif
COMMIT;`;
}

export function setRetentionJob(config, enabled, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  query(
    config.databaseUrl,
    retentionTransitionSql(maintenanceTarget(config.cwd), enabled),
  );
}

export async function probeWriteBlock(
  config,
  fetcher = fetch,
  expectedBlocked = true,
) {
  const headers = {
    apikey: config.serverKey,
    "Content-Type": "application/json",
  };
  if (config.serverKey.startsWith("eyJ"))
    headers.Authorization = `Bearer ${config.serverKey}`;
  const response = await fetcher(
    `https://${target.database}.supabase.co/rest/v1/system_banners?and=(id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000)`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ is_active: false }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (expectedBlocked) {
    let result;
    try {
      result = await response.json();
    } catch {
      /* Refuse below. */
    }
    requireCondition(
      !response.ok && result?.code === "25006",
      "A fresh PostgREST mutation was not blocked by the request guard.",
    );
  } else
    requireCondition(
      response.ok,
      "A fresh zero-row PostgREST mutation is still blocked.",
    );
}
