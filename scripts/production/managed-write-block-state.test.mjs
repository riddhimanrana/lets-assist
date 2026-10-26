import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { managedWriteBlockState } from "./managed-write-block-state.mjs";
import { managedBackupDigest } from "./recovery-receipt.mjs";
import { pointsFirstRolloutStates } from "./points-first-rollout-catalog.mjs";
import { productionRef } from "./app-release-checks.mjs";
const cwd = resolve(import.meta.dirname, "../..");
const source = "a".repeat(40);
const now = Date.now();
function fixture() {
  const at = "2026-10-25T12:34:14.676Z";
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: "riddhimanrana/lets-assist",
    GITHUB_REPOSITORY_ID: "713042374",
    GITHUB_SHA: source,
    GITHUB_RUN_ID: "456",
    GITHUB_ACTOR: "operator",
    GH_TOKEN: "synthetic-token",
    SUPABASE_PROJECT_ID: productionRef,
    SUPABASE_ACCESS_TOKEN: "synthetic-token",
    SUPABASE_DB_PASSWORD: "synthetic-password",
    SUPABASE_SECRET_KEY: "synthetic-server-key",
    PRODUCTION_DEPLOY_CONFIRMATION: `deploy-production:${productionRef}`,
    APPLICATION_WRITES_BLOCKED_CONFIRMATION: `block-application-writes:${source}`,
    EXTERNAL_WRITERS_CONFIRMATION: `external-writers-stopped:${source}`,
    RECOVERY_CAPTURE_SHA256: managedBackupDigest(at),
    RECOVERY_CAPTURE_CONFIRMATION: `managed-backup-accepted:${source}:${managedBackupDigest(at)}`,
    MANAGED_BACKUP_INSERTED_AT: at,
    PRODUCTION_JOB_STARTED_AT: String(Math.floor(now / 1000) - 60),
    EARLY_ENABLE_OUTCOME: "success",
    LATE_ENABLE_OUTCOME: "skipped",
    MAINTENANCE_ALIAS_OUTCOME: "skipped",
    APPLICATION_ALIAS_OUTCOME: "skipped",
    SCHEMA_PUSH_OUTCOME: "skipped",
  };
  const initial = pointsFirstRolloutStates.find((state) => state.count === 689);
  const state = {
    versions: initial.versions,
    fence: true,
    open: true,
    blocked: false,
    records: [],
    probes: [],
    authorityReads: 0,
  };
  const dependencies = {
    cwd,
    now: () => now,
    execute: (_cmd, args) => (args[0] === "rev-parse" ? source : ""),
    authority: async () => {
      state.authorityReads++;
    },
    connect: async (config) => ({
      ...config,
      databaseUrl: "synthetic-injected",
    }),
    query: (_connection, sql) => {
      assert.match(sql, /^BEGIN.*READ ONLY;/mu);
      return sql.includes("json_agg(version")
        ? JSON.stringify(state.versions)
        : JSON.stringify({
            fence: state.fence,
            open: state.open,
            blocked: state.blocked,
          });
    },
    record: (receipt) => state.records.push(receipt),
    probe: async (_config, _fetch, write = false) => {
      state.probes.push(write);
    },
  };
  return { env, state, dependencies };
}

test("prepare records ownership only for the exact managed-backup open guarded ledger", async () => {
  const { env, state, dependencies } = fixture();
  const receipt = await managedWriteBlockState("prepare", env, dependencies);
  assert.equal(receipt.phase, "owned-open-state");
  assert.equal(receipt.source, source);
  assert.equal(state.records.length, 1);
  assert.equal(state.authorityReads, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /synthetic/u);
});

test("preexisting blocks, invalid hooks and elapsed preparation windows never acquire ownership", async () => {
  for (const patch of [{ open: false, blocked: true }, { fence: false }]) {
    const { env, state, dependencies } = fixture();
    Object.assign(state, patch);
    await assert.rejects(managedWriteBlockState("prepare", env, dependencies));
    assert.equal(state.records.length, 0);
  }
  const { env, state, dependencies } = fixture();
  env.PRODUCTION_JOB_STARTED_AT = String(Math.floor(now / 1000) - 2101);
  await assert.rejects(managedWriteBlockState("prepare", env, dependencies));
  assert.equal(state.records.length, 0);
});

test("reset eligibility requires an acknowledged owned block, unchanged ledger, and no cutover attempt", async () => {
  const { env, state, dependencies } = fixture();
  dependencies.receipt = await managedWriteBlockState(
    "prepare",
    env,
    dependencies,
  );
  state.open = false;
  state.blocked = true;
  assert.equal(
    (await managedWriteBlockState("can-restore", env, dependencies)).phase,
    "safe-to-reset",
  );
  for (const key of [
    "EARLY_ENABLE_OUTCOME",
    "LATE_ENABLE_OUTCOME",
    "MAINTENANCE_ALIAS_OUTCOME",
    "APPLICATION_ALIAS_OUTCOME",
    "SCHEMA_PUSH_OUTCOME",
  ]) {
    const expected = env[key];
    for (const outcome of [
      "failure",
      "cancelled",
      "",
      "unknown",
      key === "EARLY_ENABLE_OUTCOME" ? "skipped" : "success",
    ]) {
      env[key] = outcome;
      await assert.rejects(
        managedWriteBlockState("can-restore", env, dependencies),
        key,
      );
    }
    env[key] = expected;
  }
  state.versions = pointsFirstRolloutStates.find(
    (entry) => entry.count === 690,
  ).versions;
  await assert.rejects(
    managedWriteBlockState("can-restore", env, dependencies),
  );
});

test("restoration verifies the exact ledger and both fixed API probes before its receipt", async () => {
  const { env, state, dependencies } = fixture();
  dependencies.receipt = await managedWriteBlockState(
    "prepare",
    env,
    dependencies,
  );
  const receipt = await managedWriteBlockState("restored", env, dependencies);
  assert.equal(receipt.phase, "restored-open-state");
  assert.deepEqual(state.probes, [false, true]);
  assert.equal(state.records.at(-1).phase, "restored-open-state");
  dependencies.probe = async () => {
    throw new Error("private-provider-sentinel");
  };
  const records = state.records.length;
  await assert.rejects(managedWriteBlockState("restored", env, dependencies));
  assert.equal(state.records.length, records);
});

test("foreign, missing and already-restored ownership receipts refuse reset eligibility", async () => {
  const { env, state, dependencies } = fixture();
  const receipt = await managedWriteBlockState("prepare", env, dependencies);
  state.open = false;
  state.blocked = true;
  for (const patch of [
    { source: "b".repeat(40) },
    { run: "789" },
    { phase: "restored-open-state" },
    { database: "other" },
    { ledger: "" },
  ]) {
    dependencies.receipt = { ...receipt, ...patch };
    await assert.rejects(
      managedWriteBlockState("can-restore", env, dependencies),
    );
  }
});
