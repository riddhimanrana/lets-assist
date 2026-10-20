import assert from "node:assert/strict";
import test from "node:test";
import { cutoverConfig, validateReceipt } from "./cutover-authority.mjs";
import {
  controllerFixture,
  environment,
  clock,
  versions,
} from "./cutover.fixture.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";
import {
  developmentCronChangeSql,
  validateDevelopmentCronJobs,
} from "./cutover-cron-control-sql.mjs";
import { validateCronPauseReceipt } from "./cutover-cron-control.mjs";

const jobs = () =>
  [
    [
      1,
      "process-automatic-check-ins",
      "* * * * *",
      "6288e4a0a6191a2f54ca14869c2866455b8cb00f13b1cfaa63342b1d292d9877",
    ],
    [
      2,
      "process-automatic-check-outs",
      "* * * * *",
      "0f8aee4a766ab64fe96c72650fbe7bf4f333138fdea5d970467fc654bfbfcb99",
    ],
    [
      4,
      "process-project-statuses",
      "*/5 * * * *",
      "74a2c6e669213519e301628302d4a5e47faf4b2228d55ec577192af284e47e24",
    ],
    [
      3,
      "retain-cron-execution-history",
      "17 * * * *",
      "ceb9e5aa2af89cd9a7878982b01f7bed511e6aab839efdb9d1e51f2f538944c5",
    ],
  ].map(([id, name, schedule, commandSha256]) => ({
    id,
    name,
    schedule,
    active: true,
    owner: "postgres",
    database: "postgres",
    commandSha256,
  }));
const paused = (value) => value.map((job) => ({ ...job, active: false }));

function cronFixture(phase = "pause-cron", receipt) {
  const f = controllerFixture(phase);
  f.config.cwd = process.cwd();
  f.state.jobs = phase === "pause-cron" ? jobs() : paused(receipt.cronBefore);
  f.state.running = 0;
  f.query = (_url, sql) => {
    if (sql.includes("'cronSnapshot'"))
      return JSON.stringify({
        cronSnapshot: f.state.jobs,
        blocked: f.state.blocked,
        runningCron: f.state.running,
      });
    if (sql.includes("'inspectionCatalog'"))
      return JSON.stringify({
        inspectionLedger: true,
        inspectionCatalog: true,
        activeCron: f.state.jobs.filter((job) => job.active).length,
        runningCron: f.state.running,
        enabledControlRows: 0,
        publicationLeases: 0,
      });
    if (sql.includes("json_agg(version::text")) return JSON.stringify(versions);
    const operation = phase === "pause-cron" ? "pause" : "resume";
    if (sql.includes(`SELECT 'development-cron-${operation}-committed'`)) {
      f.state.writes.push({ kind: operation, sql });
      f.state.jobs =
        operation === "pause"
          ? paused(f.state.jobs)
          : structuredClone(receipt.cronBefore);
      return `development-cron-${operation}-committed`;
    }
    throw new Error("Unexpected cron fixture SQL");
  };
  f.dependencies = {
    ...f.dependencies,
    query: (...args) => f.query(...args),
    wait: async () => {},
    loadReceipt: async () => structuredClone(receipt),
  };
  return f;
}

async function pauseReceipt() {
  const f = cronFixture();
  return {
    ...(await runDevelopmentCutover(f.config, f.dependencies)),
    run: "99",
  };
}

test("both cron phases retain exact candidate authority and require a fresh writer attestation", () => {
  for (const phase of ["pause-cron", "resume-cron"]) {
    assert.equal(cutoverConfig(environment(phase)).phase, phase);
    for (const patch of [
      { EXTERNAL_WRITERS_CONFIRMATION: "" },
      { GITHUB_SHA: "e".repeat(40) },
      { GITHUB_REF: "refs/heads/development" },
    ])
      assert.throws(() => cutoverConfig({ ...environment(phase), ...patch }));
  }
  assert.throws(() =>
    cutoverConfig({
      ...environment("resume-cron"),
      CUTOVER_PREPARE_RUN_ID: "100",
    }),
  );
});

test("pause records original flags before one guarded mutation and verifies fresh quiescence", async () => {
  const f = cronFixture();
  f.state.jobs[1].active = false;
  const original = structuredClone(f.state.jobs);
  const result = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(result.phase, "cron-paused");
  assert.deepEqual(result.cronBefore, original);
  assert.deepEqual(result.cronAfter, paused(original));
  assert.equal(result.schema.databaseQuiescent, true);
  assert.equal(result.maintenanceReady, false);
  assert.equal(result.aliasChanged, false);
  assert.equal(result.requestGuardChanged, false);
  assert.deepEqual(
    f.state.writes.map((write) => write.kind),
    ["pause"],
  );
  assert.equal(f.state.records[0].phase, "cron-pause-started");
  assert.deepEqual(f.state.records[0].cronBefore, original);
  assert.doesNotMatch(
    JSON.stringify(f.state.records),
    /test-password|sb_secret_fictional|postgres:\/\//u,
  );
  for (const phase of ["complete", "recover"])
    assert.throws(() =>
      validateReceipt(result, { ...f.config, phase, prepareRun: "100" }, clock),
    );
});

test("resume restores only the exact original active flags and verifies them", async () => {
  const original = await pauseReceipt();
  original.cronBefore[1].active = false;
  const f = cronFixture("resume-cron", original);
  const result = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(result.phase, "cron-resumed");
  assert.deepEqual(result.cronAfter, original.cronBefore);
  assert.deepEqual(
    f.state.writes.map((write) => write.kind),
    ["resume"],
  );
  assert.equal(f.state.blocked, false);
  assert.equal(f.state.alias, original.priorAlias);
});

test("a failed pause may be reconciled from its immutable receipt without repeating an already-restored mutation", async () => {
  const original = {
    ...(await pauseReceipt()),
    phase: "cron-pause-unproven",
    expiresAt: clock - 1,
    createdAt: clock - 3_600_000,
  };
  const f = cronFixture("resume-cron", original);
  f.state.jobs = structuredClone(original.cronBefore);
  assert.equal(
    (await runDevelopmentCutover(f.config, f.dependencies)).phase,
    "cron-resumed",
  );
  assert.deepEqual(f.state.writes, []);
});

for (const [name, change] of [
  [
    "missing protected review",
    (f) => f.state.apiChanges.set("/actions/runs/100/approvals", () => []),
  ],
  [
    "changed candidate",
    (f) =>
      f.state.apiChanges.set("/pulls/867", (pr) => ({
        ...pr,
        head: { ...pr.head, sha: "e".repeat(40) },
      })),
  ],
  [
    "held application",
    (f) => {
      f.state.domain = "codex/development-maintenance-hold";
    },
  ],
  [
    "active request fence",
    (f) => {
      f.state.blocked = true;
    },
  ],
  [
    "changed command",
    (f) => {
      f.state.jobs[0].commandSha256 = "f".repeat(64);
    },
  ],
  [
    "additional job",
    (f) => {
      f.state.jobs.push({ ...f.state.jobs[0], id: 5, name: "other" });
    },
  ],
  [
    "wrong ledger",
    (f) => {
      const query = f.query;
      f.query = (url, sql) =>
        sql.includes("json_agg(version::text")
          ? JSON.stringify(versions.slice(0, 688))
          : query(url, sql);
    },
  ],
])
  test(`pause refuses ${name} before mutation`, async () => {
    const f = cronFixture();
    change(f);
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(f.state.writes, []);
  });

for (const [name, change] of [
  [
    "different alias",
    (f) => {
      f.state.alias = "dpl_Other";
    },
  ],
  [
    "changed flags",
    (f) => {
      f.state.jobs[0].active = true;
    },
  ],
  [
    "changed job ID",
    (f) => {
      f.state.jobs[0].id = 10;
    },
  ],
  [
    "running work",
    (f) => {
      f.state.running = 1;
    },
  ],
  [
    "prepared application",
    (f) => {
      f.state.domain = "codex/development-maintenance-hold";
    },
  ],
])
  test(`resume refuses ${name} before mutation`, async () => {
    const f = cronFixture("resume-cron", await pauseReceipt());
    change(f);
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(f.state.writes, []);
  });

test("a lost commit response never retries or resumes and preserves the original recovery snapshot", async () => {
  const f = cronFixture();
  const query = f.query;
  f.query = (url, sql) => {
    const result = query(url, sql);
    if (sql.includes("SELECT 'development-cron-pause-committed'"))
      throw new Error("fictional raw credential");
    return result;
  };
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.records.at(-1).phase, "cron-pause-unproven");
  assert.deepEqual(f.state.records.at(-1).cronBefore, jobs());
  assert.doesNotMatch(
    JSON.stringify(f.state.records),
    /fictional raw credential/u,
  );
});

test("bounded drain failure keeps jobs paused and marks the result unproven", async () => {
  const f = cronFixture();
  f.state.running = 1;
  let waits = 0;
  f.dependencies.wait = async () => {
    waits++;
  };
  await assert.rejects(
    runDevelopmentCutover(f.config, f.dependencies),
    /has not drained/u,
  );
  assert.equal(waits, 29);
  assert.deepEqual(f.state.jobs, paused(jobs()));
  assert.equal(f.state.records.at(-1).phase, "cron-pause-unproven");
  assert.equal(f.state.writes.length, 1);
});

test("SQL binds both snapshots and uses only supported active-flag changes", () => {
  const sql = developmentCronChangeSql(
    versions,
    jobs(),
    paused(jobs()),
    "pause",
  );
  assert.match(sql, /cron\.alter_job\(job\.jobid,active:=job\.desired\)/u);
  assert.match(sql, /pg_advisory_xact_lock\(592043,1\)/u);
  assert.match(sql, /development_cron_guard_failed/u);
  assert.doesNotMatch(
    sql,
    /^\s*(?:(?:UPDATE|LOCK TABLE) cron\.job|ALTER ROLE|CREATE|DELETE|SELECT cron\.unschedule)/mu,
  );
  assert.ok(
    sql.includes(JSON.stringify(jobs())) &&
      sql.includes(JSON.stringify(paused(jobs()))),
  );
  assert.throws(() =>
    developmentCronChangeSql(
      versions.slice(0, 688),
      jobs(),
      paused(jobs()),
      "pause",
    ),
  );
  assert.throws(() =>
    validateDevelopmentCronJobs([{ ...jobs()[0], id: 0 }, ...jobs().slice(1)]),
  );
});

test("restore receipts refuse another source, target, original job or phase", async () => {
  const original = await pauseReceipt();
  const f = cronFixture("resume-cron", original);
  for (const patch of [
    { candidate: "e".repeat(40) },
    { controller: "e".repeat(40) },
    { phase: "prepared" },
    { run: "98" },
    { database: "fotdmeakexgrkronxlof" },
    { cronBefore: [] },
    { schema: { count: 739 } },
  ])
    assert.throws(() =>
      validateCronPauseReceipt({ ...original, ...patch }, f.config, clock),
    );
});
