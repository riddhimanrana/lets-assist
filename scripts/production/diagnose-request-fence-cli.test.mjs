import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  diagnosticLedger,
  diagnosticLedgerSql,
  requestFenceDiagnosticConfig,
  runRequestFenceDiagnostic,
  verifyDiagnosticDryRun,
} from "./diagnose-request-fence-cli.mjs";
import {
  productionBootstrapConfig,
  productionBootstrapTarget as target,
} from "./bootstrap-request-write-fence.mjs";
import {
  pointsFirstRolloutStates,
  pointsFirstRolloutMigrations,
} from "./points-first-rollout-catalog.mjs";

const cwd = resolve(import.meta.dirname, "../..");
const source = "a".repeat(40);
const now = Date.parse("2026-10-26T00:05:00Z");
const versions = pointsFirstRolloutStates[0].versions;
const ledger = JSON.stringify([{ versions }]);
const dryRunPayload = {
  upToDate: false,
  dryRun: true,
  migrations: pointsFirstRolloutMigrations.map((step) => step.migration),
  seeds: [],
  roles: [],
  message: "Finished supabase db push.",
};
const dryRun = JSON.stringify(dryRunPayload);
function environment() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: target.repository,
    GITHUB_REPOSITORY_ID: String(target.repositoryId),
    GITHUB_SHA: source,
    ACCEPTED_MAIN_SHA: source,
    GITHUB_RUN_ID: "456",
    GITHUB_ACTOR: "operator",
    GH_TOKEN: "synthetic-github",
    SUPABASE_PROJECT_ID: target.database,
    SUPABASE_ACCESS_TOKEN: "synthetic-token",
    SUPABASE_DB_PASSWORD: "synthetic-password",
    PRODUCTION_BOOTSTRAP_CONFIRMATION: `diagnose-production:${target.database}:${source}`,
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    PGOPTIONS: "unsafe-inherited-value",
    SUPABASE_API_URL: "https://elsewhere.invalid",
  };
}
function setup(change = () => {}) {
  const env = environment();
  const calls = [],
    records = [];
  const fixture = {
    "": {
      id: target.repositoryId,
      full_name: target.repository,
      default_branch: "main",
    },
    "/git/ref/heads/main": { object: { sha: source } },
    "/environments/production": {
      id: 7,
      name: "production",
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
      repository: { id: target.repositoryId },
      event: "workflow_dispatch",
      path: target.workflow,
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
        environments: [{ id: 7, name: "production" }],
      },
    ],
  };
  const dependencies = {
    now: () => now,
    read: async (path) => fixture[path],
    checkoutExecute: (_command, args) => (args[0] === "rev-parse" ? source : ""),
    record: (value) => records.push(structuredClone(value)),
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      const result = { status: 0, stdout: "", stderr: "" };
      if (args[0] === "--version") result.stdout = "2.120.0\n";
      else if (args.includes("--help"))
        result.stdout =
          "--project-ref --linked --agent --output --output-format --dry-run --include-all --skip-vault";
      else if (args[1] === "query") result.stdout = ledger;
      else if (args[1] === "push") {
        result.stdout = dryRun;
        result.stderr =
          "DRY RUN: migrations will *not* be pushed to the database.\n";
      } else if (args[0] === "link")
        result.stdout = JSON.stringify({
          project_ref: target.database,
          message: "",
        });
      change(result, args, calls);
      return result;
    },
  };
  return {
    env,
    calls,
    records,
    dependencies,
    fixture,
    run: () =>
      runRequestFenceDiagnostic(
        requestFenceDiagnosticConfig(env, cwd),
        env,
        dependencies,
      ),
  };
}

test("diagnostic needs existing CLI secrets, exact protected identity, and its own confirmation; no writer hold", () => {
  const env = environment();
  assert.equal(requestFenceDiagnosticConfig(env, cwd).databaseUrl, undefined);
  assert.throws(() => productionBootstrapConfig(env, cwd));
  for (const [key, value] of Object.entries({
    SUPABASE_ACCESS_TOKEN: "",
    SUPABASE_DB_PASSWORD: "",
    GH_TOKEN: "",
    GITHUB_REF: "refs/heads/development",
    GITHUB_RUN_ATTEMPT: "2",
    SUPABASE_PROJECT_ID: "other",
    ACCEPTED_MAIN_SHA: "b".repeat(40),
    PRODUCTION_BOOTSTRAP_CONFIRMATION: `bootstrap-production:${target.database}:${source}`,
  })) {
    assert.throws(
      () => requestFenceDiagnosticConfig({ ...env, [key]: value }, cwd),
      key,
    );
  }
});

test("strict ledger parser refuses empty output, wrong envelopes, duplicates, drift and post-bootstrap states", () => {
  assert.deepEqual(diagnosticLedger(ledger), versions);
  for (const value of [
    "",
    "Initialising login role...",
    "[]",
    "null",
    ledger + ledger,
    JSON.stringify({ rows: [{ versions }] }),
    JSON.stringify([{ versions, unexpected: true }]),
    JSON.stringify([{ versions }, { versions }]),
    JSON.stringify([{ versions: [...versions, versions[0]] }]),
    JSON.stringify([{ versions: pointsFirstRolloutStates[1].versions }]),
    JSON.stringify([{ versions: versions.slice().reverse() }]),
  ]) {
    assert.throws(() => diagnosticLedger(value));
  }
});

test("missing runtime password cannot start CLI or mint a temporary login role", async () => {
  const f = setup();
  f.env.SUPABASE_DB_PASSWORD = " ";
  await assert.rejects(
    runRequestFenceDiagnostic(
      { cwd, source, run: "456", actor: "operator", githubToken: "synthetic" },
      f.env,
      f.dependencies,
    ),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.records.at(-1).mutation, "not-attempted");
});

test("dry-run matches all 52 exact filenames in order and refuses missing, extra, reordered or duplicate files", () => {
  assert.equal(verifyDiagnosticDryRun(dryRun).length, 52);
  for (const output of [
    "",
    dryRun + dryRun,
    JSON.stringify({ ...dryRunPayload, dryRun: false }),
    JSON.stringify({ ...dryRunPayload, upToDate: true }),
    JSON.stringify({ ...dryRunPayload, roles: ["supabase/roles.sql"] }),
    JSON.stringify({ ...dryRunPayload, seeds: ["supabase/seed.sql"] }),
    JSON.stringify({ ...dryRunPayload, unexpected: true }),
    JSON.stringify({
      ...dryRunPayload,
      migrations: dryRunPayload.migrations.slice(1),
    }),
    JSON.stringify({
      ...dryRunPayload,
      migrations: [...dryRunPayload.migrations, "unexpected.sql"],
    }),
    JSON.stringify({
      ...dryRunPayload,
      migrations: dryRunPayload.migrations.slice().reverse(),
    }),
    JSON.stringify({
      ...dryRunPayload,
      migrations: [...dryRunPayload.migrations, dryRunPayload.migrations[0]],
    }),
  ]) {
    assert.throws(() => verifyDiagnosticDryRun(output));
  }
});

test("approved diagnostic verifies real repository bytes and performs only link, fixed SELECTs and native dry-run", async () => {
  const f = setup();
  const receipt = await f.run();
  assert.equal(receipt.phase, "diagnosed");
  assert.equal(receipt.mutation, "not-attempted");
  assert.equal(receipt.before, receipt.after);
  assert.equal(receipt.migrationBytes, "740-reviewed");
  assert.equal(receipt.pending.length, 52);
  assert.equal(
    receipt.pending.at(-1),
    "20261020031605_project_calendar_deletion_fence.sql",
  );
  assert.deepEqual(
    f.calls
      .filter(({ args }) => !args.includes("--help") && args[0] !== "--version")
      .map(({ args }) => args),
    [
      ["link", "--project-ref", target.database, "--output-format", "json"],
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        target.database,
        "--agent",
        "no",
        "--output",
        "json",
        diagnosticLedgerSql,
      ],
      [
        "db",
        "push",
        "--linked",
        "--project-ref",
        target.database,
        "--dry-run",
        "--include-all",
        "--skip-vault",
        "--output-format",
        "json",
      ],
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        target.database,
        "--agent",
        "no",
        "--output",
        "json",
        diagnosticLedgerSql,
      ],
    ],
  );
  for (const { command, args, options } of f.calls) {
    assert.equal(command, "supabase");
    assert.equal(options.env.SUPABASE_DB_PASSWORD, f.env.SUPABASE_DB_PASSWORD);
    assert.equal(options.env.PGOPTIONS, undefined);
    assert.equal(options.env.SUPABASE_API_URL, undefined);
    assert.ok(!args.includes(f.env.SUPABASE_DB_PASSWORD));
    assert.ok(!args.includes("--yes"));
    assert.equal(options.stdio[0], "ignore");
  }
  assert.doesNotMatch(
    JSON.stringify(f.records),
    /synthetic-token|synthetic-password|untrusted|postgresql/u,
  );
});

test("each CLI failure stops immediately and records only its phase, status and byte counts", async () => {
  const successful = setup();
  await successful.run();
  for (let index = 1; index <= successful.calls.length; index++) {
    const f = setup((result, _args, calls) => {
      if (calls.length === index)
        Object.assign(result, {
          status: 1,
          stdout: "synthetic-token",
          stderr: "postgresql://synthetic-password",
        });
    });
    await assert.rejects(f.run(), /No apply was attempted/u);
    assert.equal(f.calls.length, index);
    assert.equal(f.records.at(-1).phase, "diagnostic-failed");
    assert.doesNotMatch(
      JSON.stringify(f.records),
      /synthetic-token|synthetic-password|postgresql/u,
    );
  }
});

test("wrong link, missing review, changed migration bytes, drift and empty JSON never reach dry-run", async () => {
  for (const mutate of [
    (f) => {
      f.fixture["/actions/runs/456/approvals"] = [];
    },
    (f) => {
      f.dependencies.readMigration = () => Buffer.from("changed");
    },
    (f) => {
      f.dependencies.execute = (_command, args) => ({
        status: 0,
        stdout: args[0] === "--version" ? "2.119.0" : "",
        stderr: "",
      });
    },
  ]) {
    const f = setup();
    mutate(f);
    await assert.rejects(f.run());
    assert.ok(!f.calls.some(({ args }) => args.includes("--dry-run")));
  }
  const wrongLink = setup((result, args) => {
    if (args[0] === "link" && !args.includes("--help"))
      result.stdout = JSON.stringify({ project_ref: "other", message: "" });
  });
  await assert.rejects(wrongLink.run());
  assert.equal(wrongLink.records.at(-1).failedPhase, "link");
  assert.ok(!wrongLink.calls.some(({ args }) => args.includes("--dry-run")));
  const empty = setup((result, args) => {
    if (args[1] === "query" && !args.includes("--help")) result.stdout = "";
  });
  await assert.rejects(empty.run());
  assert.equal(empty.records.at(-1).failedPhase, "ledger-before");
});

test("after-ledger drift cannot produce a successful receipt or trigger retries", async () => {
  let queries = 0;
  const f = setup((result, args) => {
    if (args[1] === "query" && !args.includes("--help") && ++queries === 2)
      result.stdout = JSON.stringify([{ versions: versions.slice(1) }]);
  });
  await assert.rejects(f.run());
  assert.equal(f.records.at(-1).failedPhase, "ledger-after");
  assert.equal(
    f.calls.filter(({ args }) => args.includes("--dry-run")).length,
    1,
  );
});

test("workflow defaults to protected diagnosis and scopes existing secrets to separate modes", () => {
  const workflow = readFileSync(resolve(cwd, target.workflow), "utf8");
  assert.match(workflow, /default: diagnose/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /group: production-schema-deployment/u);
  assert.match(workflow, /setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf/u);
  assert.match(workflow, /version: 2\.120\.0/u);
  const diagnostic = workflow
    .split("- name: Verify approval and diagnose")[1]
    .split("- name: Verify approval and install")[0];
  assert.match(diagnostic, /if: inputs.mode == 'diagnose'/u);
  assert.doesNotMatch(
    diagnostic,
    /DATABASE_URL|SERVICE_ROLE|SECRET_KEY|EXTERNAL_WRITERS/u,
  );
  assert.match(
    workflow,
    /install the additive guard\n\s+if: inputs.mode == 'install'/u,
  );
});
