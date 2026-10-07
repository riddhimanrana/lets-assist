import {
  executeMaintenanceQuery,
  maintenanceLedgerQuery,
  maintenancePostureQuery,
  maintenanceTarget,
  maintenanceVerificationQuery,
  selectMaintenanceLedger,
} from "../production/maintenance-preflight.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { acceptedCatalogQuery } from "../production/app-release-catalog.mjs";
import {
  applicationRequestWriteFlagSql,
  settlePreexistingRequestTransactionsSql,
} from "../production/request-write-fence.mjs";
import { requireCondition, target } from "./cutover-authority.mjs";

export function developmentQuery(url, sql) {
  try {
    return executeMaintenanceQuery(url, sql);
  } catch {
    requireCondition(
      false,
      "Development database operation failed. Raw output was suppressed.",
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

export function verifyDevelopmentMaintenance(
  config,
  mode,
  query = developmentQuery,
) {
  validateDatabaseUrl(config.databaseUrl);
  const targetVersions = maintenanceTarget(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  const versions = selectMaintenanceLedger(targetVersions, applied, mode);
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
