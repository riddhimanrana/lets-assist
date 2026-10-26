import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import {
  expectedVersions,
  productionRef,
  ReleaseCheckError,
  verifyLedger,
} from "./app-release-checks.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import { maintenanceDataChecks } from "./maintenance-preflight-checks.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import {
  pointsFirstRolloutState,
  pointsFirstRolloutTarget,
} from "./points-first-rollout-catalog.mjs";
import { applicationRequestWriteFenceQuery } from "./request-write-fence.mjs";
export { applicationRequestWriteFenceQuery } from "./request-write-fence.mjs";

import {
  executeLinkedBootstrapQuery,
  prepareLinkedBootstrapConnection,
  productionTransportConfig,
  validateLinkedConnection,
} from "./linked-bootstrap-transport.mjs";

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const transaction = (sql) => `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path TO public, extensions;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
${sql}
COMMIT;`;
export const maintenanceLedgerQuery = transaction(
  "SELECT coalesce(json_agg(version::text ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations;",
).replace("statement_timeout = '120s'", "statement_timeout = '15s'");

export function maintenanceTarget(cwd, read = readFileSync) {
  const versions = expectedVersions(cwd);
  const names = readdirSync(resolve(cwd, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (versions.length < 687 || names.length !== versions.length)
    throw new ReleaseCheckError(
      "Maintenance target has an invalid migration inventory.",
    );
  for (const name of names) {
    const bytes = read(resolve(cwd, "supabase/migrations", name));
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      migrationDigests[name]
    )
      throw new ReleaseCheckError(
        "Maintenance target migration bytes are not reviewed.",
      );
  }
  // Acceptance belongs to the existing release catalog. An unknown future
  // migration cannot acquire approval merely by appearing in this checkout.
  acceptedCatalogQuery("", versions);
  return versions;
}

export function selectMaintenanceLedger(target, applied, mode) {
  if (!["before", "target"].includes(mode))
    throw new ReleaseCheckError("Invalid maintenance preflight mode.");
  if (
    !Array.isArray(applied) ||
    applied.length < 687 ||
    applied.length > target.length
  )
    throw new ReleaseCheckError(
      "Production maintenance ledger is not a reviewed prefix.",
    );
  const pointsFirst = pointsFirstRolloutState(applied);
  if (pointsFirst) {
    if (
      target.length !== pointsFirstRolloutTarget.count ||
      ledgerDigest(target) !== pointsFirstRolloutTarget.ledger
    )
      throw new ReleaseCheckError(
        "The points-first history is bound to its exact reviewed 740 target.",
      );
  } else
    verifyLedger(
      applied.map((version) => ({ version })),
      target.slice(0, applied.length),
    );
  if (mode === "target" && applied.length !== target.length)
    throw new ReleaseCheckError(
      "Production maintenance target is not fully applied.",
    );
  acceptedCatalogQuery("", applied);
  return applied;
}

const requireBoolean = (query) => `${query.trim().replace(/;$/u, "")}\n\\gset
\\if :valid
\\else
  SELECT 1 / 0 AS maintenance_check_failed;
\\endif`;

const maintenancePostureConditions = `(${applicationRequestWriteFenceQuery.replace(/ AS valid$/u, "")})
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator'
    AND 'pgrst.app_settings.maintenance_write_block=on' = ANY(coalesce(rolconfig, ARRAY[]::text[])))
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting setting
    WHERE setting.setrole = 'authenticator'::regrole
      AND setting.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
      AND 'pgrst.app_settings.maintenance_write_block=off' = ANY(setting.setconfig))
  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE active)
  AND NOT EXISTS (SELECT 1 FROM cron.job_run_details WHERE status = 'running')
  AND NOT EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
    WHERE workbook_refresh IS NOT FALSE OR import_commit IS NOT FALSE
      OR communications IS NOT FALSE OR scheduled_post_publisher IS NOT FALSE
      OR publication_notifications IS NOT FALSE)
  AND NOT EXISTS (SELECT 1 FROM plugin_data.csf_publication_notification_deliveries
    WHERE status = 'processing' AND lease_expires_at > now())`;
export const maintenancePostureQuery = `SELECT
  current_setting('transaction_read_only') = 'on'
  AND ${maintenancePostureConditions} AS valid`;

export function maintenanceCatalogQuery(
  versions,
  accepted = acceptedCatalogQuery,
) {
  const catalog = accepted("", versions);
  const retentionState =
    "'schedule',schedule,'command',command,'username',username,'active',active,";
  if (catalog.split(retentionState).length !== 2)
    throw new ReleaseCheckError(
      "Maintenance cron inventory contract needs review.",
    );
  // The runtime manifest records the retention job enabled. Maintenance must
  // stop it, while still comparing its exact command, schedule and ownership.
  // The separate posture query requires every actual cron row to be inactive.
  return catalog.replace(
    retentionState,
    retentionState.replace("'active',active", "'active',true"),
  );
}

function verificationChecks(versions, writable) {
  const catalog = maintenanceCatalogQuery(versions).trim().replace(/;$/u, "");
  return [
    requireBoolean(`SELECT array_agg(version::text ORDER BY version)
      IS NOT DISTINCT FROM ARRAY[${versions.map(literal).join(",")}]::text[] AS valid
      FROM supabase_migrations.schema_migrations`),
    requireBoolean(`SELECT (${catalog}) = 1 AS valid`),
    requireBoolean(
      writable
        ? `SELECT ${maintenancePostureConditions} AS valid`
        : maintenancePostureQuery,
    ),
    ...maintenanceDataChecks.map(({ query }) => requireBoolean(query)),
  ].join("\n");
}

// Only the reviewed migration transaction uses the writable variant. It retains
// every guard, catalog and data check; only transaction_read_only differs.
export function maintenanceMutationVerificationSql(versions) {
  return verificationChecks(versions, true);
}

export function maintenanceVerificationQuery(versions) {
  return transaction(`${verificationChecks(versions, false)}
SELECT 'maintenance-preflight-verified';`);
}

export function validateMaintenanceBinding(projectRef, databaseUrl) {
  if (databaseUrl && typeof databaseUrl === "object") {
    if (projectRef !== productionRef)
      throw new ReleaseCheckError("Invalid Production project binding.");
    validateLinkedConnection(databaseUrl);
    return;
  }
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    /* Refuse below without logging input. */
  }
  let username;
  let password;
  try {
    username = decodeURIComponent(url?.username ?? "");
    password = decodeURIComponent(url?.password ?? "");
  } catch {
    /* Refuse below. */
  }
  if (
    projectRef !== productionRef ||
    !url ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !username ||
    !password ||
    [...(username + password)].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    url.hash ||
    url.pathname !== "/postgres" ||
    (url.port && !["5432", "6543"].includes(url.port)) ||
    !(
      url.hostname === `db.${productionRef}.supabase.co` ||
      (url.hostname.endsWith(".pooler.supabase.com") &&
        username === `postgres.${productionRef}`)
    ) ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.searchParams.getAll("sslmode").length > 1 ||
    (url.searchParams.has("sslmode") &&
      !["require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode"),
      ))
  )
    throw new ReleaseCheckError(
      "Invalid Production maintenance database binding.",
    );
}

export function executeMaintenanceQuery(
  databaseUrl,
  sql,
  execute = execFileSync,
) {
  return executeQuery(databaseUrl, sql, execute, false);
}

// Fixed preflight builders select read-only policy on either transport.
// Caller/environment SQL is never read by the command entry point.
export function executeReadOnlyQuery(databaseUrl, sql, execute = execFileSync) {
  return executeQuery(databaseUrl, sql, execute, true);
}

function executeQuery(databaseUrl, sql, execute, readOnly) {
  try {
    if (databaseUrl && typeof databaseUrl === "object") {
      return executeLinkedBootstrapQuery(
        databaseUrl,
        sql,
        databaseUrl.password,
        execute,
        {
          readOnly,
          timeout: readOnly && sql === quiescenceSql ? 30_000 : 150_000,
        },
      );
    }
    const url = new URL(databaseUrl);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.slice(1));
    const sslmode = url.searchParams.get("sslmode") ?? "require";
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !username ||
      !password ||
      !/^[A-Za-z0-9_-]+$/u.test(database) ||
      [...(username + password)].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      url.hash ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length > 1 ||
      !["require", "verify-ca", "verify-full"].includes(sslmode)
    )
      throw new Error("Invalid database connection parameters.");
    return execute("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      timeout: readOnly && sql === quiescenceSql ? 30_000 : 150_000,
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      // Keep the credential out of argv and exclude inherited PGOPTIONS,
      // PGSERVICE and psql startup configuration.
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        PGHOST: url.hostname.replace(/^\[|\]$/gu, ""),
        PGPORT: url.port || "5432",
        PGUSER: username,
        PGPASSWORD: password,
        PGDATABASE: database,
        PGSSLMODE: sslmode,
        PGCONNECT_TIMEOUT: "15",
        ...(readOnly
          ? {
              PGOPTIONS:
                "-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=120000 -c lock_timeout=5000",
            }
          : {}),
      },
    }).trim();
  } catch {
    throw new ReleaseCheckError(
      "Production maintenance preflight failed. Raw output was suppressed.",
    );
  }
}

export function verifyMaintenancePreflight(
  config,
  query = executeReadOnlyQuery,
) {
  validateMaintenanceBinding(config.projectRef, config.databaseUrl);
  const target = maintenanceTarget(config.cwd);
  if (!["before", "target"].includes(config.mode))
    throw new ReleaseCheckError("Invalid maintenance preflight mode.");
  let applied;
  try {
    applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  } catch {
    throw new ReleaseCheckError(
      "Production maintenance ledger could not be verified.",
    );
  }
  const versions = selectMaintenanceLedger(target, applied, config.mode);
  if (
    query(config.databaseUrl, maintenanceVerificationQuery(versions)) !==
    "maintenance-preflight-verified"
  )
    throw new ReleaseCheckError(
      "Production maintenance preflight did not return its exact receipt.",
    );
  return {
    ...maintenanceConnectionReceipt(config),
    transaction: "read-only",
    mode: config.mode,
    migrations: versions.length,
    head: versions.at(-1),
    ledger: ledgerDigest(versions),
    targetMigrations: target.length,
    catalog: "verified",
    writes: "configured-request-guard",
    workers: "disabled",
    cron: "quiescent",
  };
}

export function productionMaintenanceConfig(env, cwd = process.cwd()) {
  const configured = env.PRODUCTION_READONLY_URL;
  const config = {
    cwd,
    projectRef: env.EXPECTED_SUPABASE_PROJECT_REF,
    databaseUrl: configured || null,
    connectionSource: configured
      ? "production-readonly-url"
      : "management-metadata-session-psql",
    ...(!configured ? productionTransportConfig(env) : {}),
  };
  if (config.projectRef !== productionRef)
    throw new ReleaseCheckError("Invalid Production project binding.");
  if (configured) validateMaintenanceBinding(config.projectRef, configured);
  return config;
}

export async function resolveMaintenanceConnection(config, fetcher) {
  if (config.databaseUrl) return config;
  const connection = await prepareLinkedBootstrapConnection(config, fetcher);
  return {
    ...config,
    databaseUrl: Object.freeze({
      ...connection,
      password: config.databasePassword,
    }),
  };
}

export function maintenanceConnectionReceipt(config) {
  validateMaintenanceBinding(config.projectRef, config.databaseUrl);
  if (typeof config.databaseUrl === "object")
    return {
      connectionSource: "management-metadata-session-psql",
      databaseAuthority: "owner",
      transactionPolicy: "read-only",
    };
  const url = new URL(config.databaseUrl);
  return {
    connectionSource: [
      "production-readonly-url",
      "production-bootstrap-database-url",
    ].includes(config.connectionSource)
      ? config.connectionSource
      : "explicit-connection",
    databaseAuthority:
      decodeURIComponent(url.username) ===
      (url.hostname === `db.${productionRef}.supabase.co`
        ? "postgres"
        : `postgres.${productionRef}`)
        ? "owner"
        : "configured-role-unverified",
    transactionPolicy: "read-only",
  };
}

const quiescenceSql = readFileSync(
  new URL("./verify-cutover-quiescence.sql", import.meta.url),
  "utf8",
);
const quiescenceReceipt = [
  "PASS Q1: no active pg_cron schedules.",
  "PASS Q2: no pg_cron execution is still running.",
  "PASS Q3: the PostgREST maintenance flag is configured. Hook and fresh API verification are separate requirements.",
].join("\n");

export function verifyMaintenanceQuiescence(
  config,
  query = executeReadOnlyQuery,
) {
  const receipt = maintenanceConnectionReceipt(config);
  if (query(config.databaseUrl, quiescenceSql) !== quiescenceReceipt)
    throw new ReleaseCheckError(
      "Production quiescence did not return its exact receipt. Raw output was suppressed.",
    );
  return { ...receipt, transaction: "read-only", quiescence: "verified" };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new ReleaseCheckError(
        "Production preflight requires one fixed mode.",
      );
    const config = await resolveMaintenanceConnection(
      productionMaintenanceConfig(process.env),
    );
    const mode = process.argv[2];
    console.log(
      JSON.stringify(
        mode === "credentials"
          ? { ...maintenanceConnectionReceipt(config), binding: "validated" }
          : mode === "quiescence"
            ? verifyMaintenanceQuiescence(config)
            : verifyMaintenancePreflight({ ...config, mode }),
      ),
    );
  } catch (error) {
    console.error(
      error instanceof ReleaseCheckError
        ? error.message
        : "Production maintenance verification failed. Raw output was suppressed.",
    );
    process.exitCode = 1;
  }
}
