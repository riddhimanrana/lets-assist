import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReleaseCheckError } from "./app-release-checks.mjs";
import {
  maintenanceMutationVerificationSql,
  maintenanceTarget,
} from "./maintenance-preflight.mjs";
import { ledgerDigest } from "./final-schema-manifest.mjs";
import {
  pointsFirstRemainingMigrations,
  pointsFirstRolloutState,
  pointsFirstRolloutStates,
  pointsFirstRolloutTarget,
} from "./points-first-rollout-catalog.mjs";

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const requireCondition = (condition, message) => {
  if (!condition) throw new ReleaseCheckError(message);
};

export function verifyPointsFirstSource(cwd, read = readFileSync) {
  const versions = maintenanceTarget(cwd, read);
  requireCondition(
    versions.length === pointsFirstRolloutTarget.count &&
      ledgerDigest(versions) === pointsFirstRolloutTarget.ledger,
    "The bounded Production rollout requires its exact reviewed 740 source.",
  );
}

export function pointsFirstPlan(cwd, versions, read = readFileSync) {
  verifyPointsFirstSource(cwd, read);
  const state = pointsFirstRolloutState(versions);
  requireCondition(
    state && state.index > 0,
    "The bounded rollout requires an exact rehearsed state with the request fence installed.",
  );
  return {
    state,
    remaining: pointsFirstRemainingMigrations(versions),
    target: pointsFirstRolloutTarget,
  };
}

export function preparePointsFirstMigration(
  cwd,
  versions,
  read = readFileSync,
) {
  const plan = pointsFirstPlan(cwd, versions, read);
  requireCondition(
    plan.remaining.length > 0,
    "The reviewed target is already applied.",
  );
  const migration = plan.remaining[0];
  const sql = read(
    resolve(cwd, "supabase/migrations", migration.migration),
    "utf8",
  );
  requireCondition(
    createHash("sha256").update(sql).digest("hex") === migration.sha256,
    "The next migration bytes differ from the reviewed rehearsal.",
  );
  const body = sql
    .replace(/^BEGIN;[ \t]*\r?\n/mu, "")
    .replace(/\s*COMMIT;\s*$/u, "");
  requireCondition(
    !/^\s*(?:BEGIN\s*;|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b|END\s*;\s*$)/imu.test(
      // PL/pgSQL END statements do not end the containing SQL transaction.
      body.replace(/^\s*END\s*;\s*$/gimu, ""),
    ) &&
      !/\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/iu.test(body),
    "The next migration cannot run inside the reviewed atomic transaction.",
  );
  const after = pointsFirstRolloutState(
    pointsFirstRolloutStates[plan.state.index + 1].versions,
  );
  return { before: plan.state, after, migration, sql, body };
}

export function pointsFirstMutationSql(plan) {
  return `\\o /dev/null
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_catalog.pg_advisory_xact_lock(592042,1);
SELECT pg_catalog.pg_advisory_xact_lock(592043,1);
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE;
LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE;
${maintenanceMutationVerificationSql(plan.before.versions)}
${plan.body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (${literal(plan.migration.version)},${literal(plan.migration.migration.slice(15, -4))},ARRAY[${literal(plan.sql)}]);
${
  plan.migration.version === "20261009090000"
    ? "SELECT cron.alter_job(job_id := jobid, active := false) FROM cron.job WHERE jobname='process-project-statuses';"
    : ""
}
${maintenanceMutationVerificationSql(plan.after.versions)}
COMMIT;
\\o
SELECT 'points-first-migration-applied';`;
}
