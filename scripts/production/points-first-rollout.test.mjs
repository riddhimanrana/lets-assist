import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { productionRef } from "./app-release-checks.mjs";
import {
  maintenanceLedgerQuery,
  maintenanceVerificationQuery,
} from "./maintenance-preflight.mjs";
import { pointsFirstRolloutStates } from "./points-first-rollout-catalog.mjs";
import {
  pointsFirstPlan,
  preparePointsFirstMigration,
  pointsFirstMutationSql,
} from "./points-first-rollout-plan.mjs";
import {
  boundedPointsFirstQuery,
  productionPointsFirstConfig,
  runProductionPointsFirst,
  verifyPointsFirstAuthority,
} from "./points-first-rollout.mjs";
import { productionRunTarget } from "./production-run-authority.mjs";

const cwd = resolve(import.meta.dirname, "../..");
const source = "a".repeat(40);
const now = Date.parse("2026-10-16T10:00:00Z");
const stateAt = (count) =>
  pointsFirstRolloutStates.find((state) => state.count === count);
function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: productionRunTarget.repository,
    GITHUB_REPOSITORY_ID: String(productionRunTarget.repositoryId),
    GITHUB_SHA: source,
    GITHUB_RUN_ID: "456",
    GITHUB_ACTOR: "operator",
    GH_TOKEN: "synthetic-github",
    SUPABASE_PROJECT_ID: productionRef,
    PRODUCTION_BOOTSTRAP_DATABASE_URL: `postgresql://postgres:synthetic-value@db.${productionRef}.supabase.co/postgres`,
    PRODUCTION_DEPLOY_CONFIRMATION: `deploy-production:${productionRef}`,
    APPLICATION_WRITES_BLOCKED_CONFIRMATION: `application-writes-blocked:${source}`,
    EXTERNAL_WRITERS_CONFIRMATION: `external-writers-stopped:${source}`,
    RECOVERY_CAPTURE_SHA256: "b".repeat(64),
    RECOVERY_CAPTURE_CONFIRMATION: `recovery-capture-verified:${source}:${"b".repeat(64)}`,
  };
}
const config = () => productionPointsFirstConfig(environment(), cwd);
function fixture(count = 736) {
  const data = {
    "": {
      ...productionRunTarget,
      id: productionRunTarget.repositoryId,
      full_name: productionRunTarget.repository,
      default_branch: "main",
    },
    "/git/ref/heads/main": { object: { sha: source } },
    "/environments/production": {
      id: 7,
      name: "Production",
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [
            { type: "User", reviewer: { id: 202, login: "reviewer" } },
          ],
        },
      ],
    },
    "/actions/runs/456": {
      id: 456,
      repository: { id: productionRunTarget.repositoryId },
      event: "workflow_dispatch",
      path: ".github/workflows/deploy-schema.yml",
      head_sha: source,
      head_branch: "main",
      run_attempt: 1,
      status: "in_progress",
      actor: { id: 101, login: "operator" },
      triggering_actor: { id: 101, login: "operator" },
      created_at: new Date(now - 60_000).toISOString(),
    },
    "/collaborators/operator/permission": { permission: "write" },
    "/actions/runs/456/approvals": [
      {
        state: "approved",
        user: { id: 202, login: "reviewer" },
        environments: [{ id: 7, name: "Production" }],
      },
    ],
    "/actions/runs/456/jobs?filter=latest&per_page=100": {
      total_count: 1,
      jobs: [
        {
          name: "Require prior Production reconciliations",
          run_id: 456,
          head_sha: source,
          status: "completed",
          conclusion: "success",
        },
      ],
    },
  };
  const state = {
    versions: [...stateAt(count).versions],
    writes: 0,
    authorityReads: 0,
    receipts: [],
    lost: false,
    rollback: false,
    drift: false,
    revokeAt: 0,
    moveMainAt: 0,
  };
  const dependencies = {
    now: () => now,
    record: (receipt) => state.receipts.push(receipt),
    execute: (_command, args) => (args[0] === "rev-parse" ? `${source}\n` : ""),
    read: async (path) => {
      if (path === "") state.authorityReads++;
      if (
        path.endsWith("/approvals") &&
        state.authorityReads === state.revokeAt
      )
        return [];
      if (
        path === "/git/ref/heads/main" &&
        state.authorityReads === state.moveMainAt
      )
        return { object: { sha: "c".repeat(40) } };
      assert.ok(Object.hasOwn(data, path));
      return data[path];
    },
    query: (_url, sql) => {
      if (sql === maintenanceLedgerQuery) return JSON.stringify(state.versions);
      if (sql.endsWith("SELECT 'points-first-migration-applied';")) {
        const next = preparePointsFirstMigration(cwd, state.versions);
        assert.equal(sql, pointsFirstMutationSql(next));
        state.writes++;
        if (!state.rollback) state.versions = [...next.after.versions];
        if (state.lost || state.rollback)
          throw new Error("private-transport-sentinel");
        return "points-first-migration-applied";
      }
      assert.equal(sql, maintenanceVerificationQuery(state.versions));
      if (state.drift) throw new Error("private-catalog-sentinel");
      return "maintenance-preflight-verified";
    },
  };
  return { data, state, dependencies };
}

test("configuration binds the existing owner connection and every recovery receipt to this main run", () => {
  assert.equal(config().source, source);
  for (const key of [
    "GITHUB_ACTIONS",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_ACTOR",
    "GH_TOKEN",
    "SUPABASE_PROJECT_ID",
    "PRODUCTION_BOOTSTRAP_DATABASE_URL",
    "PRODUCTION_DEPLOY_CONFIRMATION",
    "APPLICATION_WRITES_BLOCKED_CONFIRMATION",
    "EXTERNAL_WRITERS_CONFIRMATION",
    "RECOVERY_CAPTURE_SHA256",
    "RECOVERY_CAPTURE_CONFIRMATION",
  ])
    assert.throws(
      () => productionPointsFirstConfig({ ...environment(), [key]: "" }, cwd),
      key,
    );
  assert.throws(() =>
    productionPointsFirstConfig(
      { ...environment(), GITHUB_RUN_ATTEMPT: "2" },
      cwd,
    ),
  );
  assert.throws(() =>
    productionPointsFirstConfig(
      {
        ...environment(),
        PRODUCTION_BOOTSTRAP_DATABASE_URL:
          environment().PRODUCTION_BOOTSTRAP_DATABASE_URL.replace(
            "postgres:synthetic",
            "reader:synthetic",
          ),
      },
      cwd,
    ),
  );
});

test("all 50 remaining files fit one locked transaction and preserve the exact before/after guards", () => {
  for (const state of pointsFirstRolloutStates.slice(1, -1)) {
    const plan = preparePointsFirstMigration(cwd, state.versions);
    const sql = pointsFirstMutationSql(plan);
    assert.equal(plan.after.count, state.count + 1);
    assert.equal(sql.match(/^BEGIN ISOLATION/gmu)?.length, 1);
    assert.doesNotMatch(plan.body, /^\s*(?:BEGIN;|COMMIT;)$/gimu);
    assert.match(sql, /COMMIT;\n\\o\nSELECT/);
    assert.match(sql, /pg_advisory_xact_lock\(592042,1\)/u);
    assert.match(sql, /pg_advisory_xact_lock\(592043,1\)/u);
    assert.match(
      sql,
      /LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE/u,
    );
    assert.match(sql, /csf_retention_retired_cohorts/u);
    assert.match(sql, /maintenance_write_block=on/u);
    assert.match(sql, /WHERE active/u);
    assert.doesNotMatch(
      sql,
      /current_setting\('transaction_read_only'\) = 'on'/u,
    );
    assert.equal(
      sql.includes("cron.alter_job"),
      plan.migration.version === "20261009090000",
    );
    assert.match(sql, /^\\o \/dev\/null/u);
    assert.match(
      sql,
      /COMMIT;\n\\o\nSELECT 'points-first-migration-applied';$/u,
    );
  }
  assert.throws(() => pointsFirstPlan(cwd, stateAt(688).versions));
  assert.throws(() =>
    pointsFirstPlan(cwd, [...stateAt(689).versions, "20990101000000"]),
  );
  assert.throws(() =>
    preparePointsFirstMigration(
      cwd,
      stateAt(689).versions,
      (path, encoding) => `${readFileSync(path, encoding)} `,
    ),
  );
});

test("the plan lists only exact remaining bytes and performs no write", async () => {
  const { state, dependencies } = fixture();
  const receipt = await runProductionPointsFirst(
    config(),
    "plan",
    dependencies,
  );
  assert.equal(state.writes, 0);
  assert.equal(receipt.phase, "planned");
  assert.equal(receipt.remaining.length, 4);
  assert.equal(
    receipt.remaining[0].migration,
    preparePointsFirstMigration(cwd, state.versions).migration.migration,
  );
});

test("the controller applies each exact file once, verifies readback and retains sanitized progress", async () => {
  const { state, dependencies } = fixture();
  const receipt = await runProductionPointsFirst(
    config(),
    "apply",
    dependencies,
  );
  assert.equal(state.writes, 4);
  assert.equal(receipt.phase, "verified");
  assert.equal(receipt.targetMigrations, 740);
  assert.equal(receipt.migrations.length, 4);
  assert.ok(
    receipt.migrations.every(
      (entry) => entry.outcome === "acknowledged-and-verified",
    ),
  );
  assert.equal(
    state.receipts[0].migrations.length,
    1,
    "persisted progress must not share mutable arrays",
  );
  assert.doesNotMatch(
    JSON.stringify(state.receipts),
    /synthetic-value|synthetic-github|postgresql:|private-/u,
  );
});

test("an already verified target performs no write", async () => {
  const { state, dependencies } = fixture(740);
  assert.equal(
    (await runProductionPointsFirst(config(), "apply", dependencies)).phase,
    "verified",
  );
  assert.equal(state.writes, 0);
});

test("a lost response stops after one committed file even when readback succeeds", async () => {
  const { state, dependencies } = fixture();
  state.lost = true;
  await assert.rejects(
    runProductionPointsFirst(config(), "apply", dependencies),
    /trusted recovery/u,
  );
  assert.equal(state.writes, 1);
  assert.equal(state.versions.length, 737);
  const receipt = state.receipts.at(-1);
  assert.equal(receipt.phase, "unproven");
  assert.equal(
    receipt.migrations[0].outcome,
    "verified-after-unknown-response",
  );
});

test("an unchanged ledger or catalog refusal stops without another write", async () => {
  for (const failure of ["rollback", "drift"]) {
    const { state, dependencies } = fixture();
    state[failure] = true;
    await assert.rejects(
      runProductionPointsFirst(config(), "apply", dependencies),
    );
    assert.equal(state.writes, failure === "rollback" ? 1 : 0);
    assert.equal(state.versions.length, 736);
  }
});

test("changed main or a revoked review stops before the next file", async () => {
  for (const failure of ["moveMainAt", "revokeAt"]) {
    const { state, dependencies } = fixture();
    state[failure] = 3;
    await assert.rejects(
      runProductionPointsFirst(config(), "apply", dependencies),
    );
    assert.equal(state.writes, 1);
  }
});

test("missing, unrelated, ambiguous or failed prior-recovery jobs cannot authorize writes", async () => {
  for (const mutate of [
    (jobs) => {
      jobs.total_count = 101;
    },
    (jobs) => {
      jobs.jobs[0].conclusion = "failure";
    },
    (jobs) => {
      jobs.jobs[0].run_id = 457;
    },
    (jobs) => {
      jobs.jobs[0].head_sha = "c".repeat(40);
    },
    (jobs) => {
      jobs.jobs[0].name = "some other gate";
    },
    (jobs) => {
      jobs.jobs.push(jobs.jobs[0]);
      jobs.total_count++;
    },
  ]) {
    const { data, dependencies } = fixture();
    mutate(data["/actions/runs/456/jobs?filter=latest&per_page=100"]);
    await assert.rejects(
      verifyPointsFirstAuthority(config(), dependencies.read, now),
    );
  }
});

test("reviewer membership and independent-review policy are checked at action time", async () => {
  const { data, dependencies } = fixture();
  data[
    "/environments/production"
  ].protection_rules[0].reviewers[0].reviewer.login = "someone-else";
  await assert.rejects(
    verifyPointsFirstAuthority(config(), dependencies.read, now),
    /current Production policy/u,
  );
  data[
    "/environments/production"
  ].protection_rules[0].reviewers[0].reviewer.login = "operator";
  data["/actions/runs/456/approvals"][0].user = { id: 101, login: "operator" };
  await assert.rejects(
    verifyPointsFirstAuthority(config(), dependencies.read, now),
    /independent reviewer/u,
  );
});

test("immutable reviewer identity cannot be replaced by a matching login", async () => {
  const { data, dependencies } = fixture();
  data["/actions/runs/456/approvals"][0].user.id = 303;
  await assert.rejects(
    verifyPointsFirstAuthority(config(), dependencies.read, now),
    /current Production policy/u,
  );
});

test("a post-commit catalog refusal leaves one unproven file and stops", async () => {
  const { state, dependencies } = fixture();
  const query = dependencies.query;
  dependencies.query = (url, sql) => {
    if (state.writes && sql === maintenanceVerificationQuery(state.versions))
      throw new Error("private-drift");
    return query(url, sql);
  };
  await assert.rejects(
    runProductionPointsFirst(config(), "apply", dependencies),
  );
  assert.equal(state.writes, 1);
  assert.equal(state.receipts.at(-1).phase, "unproven");
});

test("the write budget prevents a second file after expiry", async () => {
  const { state, dependencies } = fixture();
  dependencies.now = () => now + (state.writes ? 10 * 60 * 1000 : 0);
  await assert.rejects(
    runProductionPointsFirst(config(), "apply", dependencies),
  );
  assert.equal(state.writes, 1);
});

test("database calls cannot outlive the invocation deadline", () => {
  let calls = 0;
  assert.equal(
    boundedPointsFirstQuery(
      config().databaseUrl,
      "fixed-sql",
      now + 9000,
      () => now,
      (_command, _args, options) => {
        calls++;
        assert.equal(options.timeout, 9000);
        assert.equal(options.input, "fixed-sql");
        return "safe-receipt";
      },
    ),
    "safe-receipt",
  );
  assert.throws(() =>
    boundedPointsFirstQuery(
      config().databaseUrl,
      "fixed-sql",
      now,
      () => now,
      () => {
        calls++;
      },
    ),
  );
  assert.equal(calls, 1);
});

test("workflow keeps the trusted recovery topology and replaces every broad db push", () => {
  const yaml = readFileSync(
    resolve(cwd, ".github/workflows/deploy-schema.yml"),
    "utf8",
  );
  assert.doesNotMatch(yaml, /supabase db push/u);
  assert.equal(yaml.match(/points-first-rollout\.mjs plan/gu)?.length, 2);
  assert.equal(yaml.match(/points-first-rollout\.mjs apply/gu)?.length, 1);
  assert.equal(yaml.match(/^ {4}environment: production$/gmu)?.length, 1);
  assert.match(yaml, /- name: Push schema to production/u);
  assert.match(yaml, /production-recovery-gate:/u);
  assert.match(
    yaml,
    /production-release-recovery-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/u,
  );
});
