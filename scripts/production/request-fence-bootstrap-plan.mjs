import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectedVersions, ReleaseCheckError } from "./app-release-checks.mjs";
import {
  maintenanceCatalogQuery,
  maintenancePostureQuery,
  applicationRequestWriteFenceQuery,
} from "./maintenance-preflight.mjs";
import { settlePreexistingRequestTransactionsSql } from "./request-write-fence.mjs";
import { migrationDigests } from "./migration-digests.mjs";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};
const start = "  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE active)";
requireCondition(
  maintenancePostureQuery.split(start).length === 2,
  "The bootstrap quiescence contract needs review.",
);
const quiescencePredicate = `true${maintenancePostureQuery.slice(maintenancePostureQuery.indexOf(start))}`;

export const bootstrapVersion = "20260929051600";
export const bootstrapFilename = `${bootstrapVersion}_application_request_write_fence.sql`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const requireSql = (expression) => `SELECT (${expression}) AS valid \\gset
\\if :valid
\\else
SELECT 1/0;
\\endif`;
const guardOff = `NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_db_role_setting s
  CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) AS entry(setting)
  WHERE s.setrole IN (0, 'authenticator'::regrole)
    AND s.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))
    AND (pg_catalog.split_part(entry.setting,'=',1)='default_transaction_read_only'
      OR (pg_catalog.split_part(entry.setting,'=',1)='pgrst.db_pre_config' AND entry.setting<>'pgrst.db_pre_config=')
      OR (pg_catalog.split_part(entry.setting,'=',1)='pgrst.app_settings.maintenance_write_block'
        AND (s.setrole<>'authenticator'::regrole OR s.setdatabase<>0
          OR entry.setting<>'pgrst.app_settings.maintenance_write_block=off'))))`;

export function bootstrapPlan(cwd, read = readFileSync) {
  const versions = expectedVersions(cwd).slice(0, 688);
  const names = readdirSync(resolve(cwd, "supabase/migrations"))
    .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
    .sort()
    .slice(0, 688);
  requireCondition(
    versions.length === 688,
    "The bootstrap prefix is incomplete.",
  );
  for (const name of names)
    requireCondition(
      digest(read(resolve(cwd, "supabase/migrations", name))) ===
        migrationDigests[name],
      "The bootstrap prefix migration bytes are not reviewed.",
    );
  requireCondition(
    versions[686] === "20260929051500" && versions[687] === bootstrapVersion,
    "The write-fence bootstrap must immediately follow the published baseline.",
  );
  const sql = read(
    resolve(cwd, "supabase/migrations", bootstrapFilename),
    "utf8",
  );
  requireCondition(
    digest(sql) === migrationDigests[bootstrapFilename],
    "The bootstrap migration bytes are not reviewed.",
  );
  const body = sql
    .replace(/^BEGIN;[ \t]*\r?\n/mu, "")
    .replace(/\s*COMMIT;\s*$/u, "");
  requireCondition(body !== sql, "The bootstrap transaction envelope changed.");
  const before = versions.slice(0, 687);
  const after = versions.slice(0, 688);
  // Both catalog manifests must come from a replay of these exact bytes.
  maintenanceCatalogQuery(before);
  maintenanceCatalogQuery(after);
  return { before, after, sql, body };
}

export function bootstrapVerificationSql(versions) {
  const catalog = maintenanceCatalogQuery(versions).trim().replace(/;$/u, "");
  return [
    requireSql(`(SELECT array_agg(version::text ORDER BY version) FROM supabase_migrations.schema_migrations)
      IS NOT DISTINCT FROM ARRAY[${versions.map(literal).join(",")}]::text[]`),
    requireSql(`(${catalog})=1`),
    requireSql(
      `(${quiescencePredicate.replace(/ AS valid$/u, "")}) AND (${guardOff})`,
    ),
    ...(versions.includes(bootstrapVersion)
      ? [
          requireSql(
            `(${applicationRequestWriteFenceQuery.replace(/ AS valid$/u, "")})`,
          ),
        ]
      : []),
  ].join("\n");
}

export function bootstrapMutationSql(plan) {
  return `BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_catalog.pg_advisory_xact_lock(592042,1);
SELECT pg_catalog.pg_advisory_xact_lock(592043,1);
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE;
LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE;
${bootstrapVerificationSql(plan.before)}
${plan.body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (${literal(bootstrapVersion)},'application_request_write_fence',ARRAY[${literal(plan.sql)}]);
${bootstrapVerificationSql(plan.after)}
COMMIT;
${settlePreexistingRequestTransactionsSql}
SELECT 'request-fence-bootstrap-applied';`;
}
