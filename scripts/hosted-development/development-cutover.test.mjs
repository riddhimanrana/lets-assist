import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cutoverConfig,
  target,
  validateReceipt,
  verifyAuthority,
} from "./cutover-authority.mjs";
import {
  probeWriteBlock,
  retentionTransitionSql,
  validateDatabaseUrl,
  writeBlockSql,
} from "./cutover-database.mjs";
import {
  applicationPayload,
  holdDomain,
  validateDeployment,
  verifyApplicationPage,
  verifyNoCompetingDeployment,
} from "./cutover-vercel.mjs";
import { runDevelopmentCutover } from "./development-cutover.mjs";
import {
  base,
  candidate,
  clock,
  controllerFixture,
  environment,
  merged,
  preparedReceipt,
  versions,
} from "./cutover.fixture.mjs";

test("configured same-owner environment approval permits preparation", async () => {
  const f = controllerFixture();
  assert.equal((await verifyAuthority(f.config, f.github)).base, base);
});

for (const [key, value] of Object.entries({
  GITHUB_REPOSITORY: "elsewhere/repo",
  GITHUB_REPOSITORY_ID: "1",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_ACTIONS: "false",
  GITHUB_EVENT_NAME: "push",
  GITHUB_SHA: merged,
  GITHUB_REF: "refs/heads/main",
  VERCEL_ROOT_PROJECT_ID: "prj_other",
  VERCEL_TEAM_ID: "team_other",
  SUPABASE_PROJECT_ID: "fotdmeakexgrkronxlof",
  SUPABASE_URL: "https://api.lets-assist.com",
  EXTERNAL_WRITERS_CONFIRMATION: "true",
  CUTOVER_PR_NUMBER: "1.1",
  DEVELOPMENT_DATABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
  CSF_DEVELOPMENT_SUPABASE_PUBLISHABLE_KEY: "",
}))
  test(`configuration refuses ${key} outside exact prepare authority`, () => {
    assert.throws(() => cutoverConfig({ ...environment(), [key]: value }));
  });

for (const [name, path, change] of [
  [
    "no environment reviewers",
    "/environments/development",
    (r) => ({ ...r, protection_rules: [] }),
  ],
  [
    "completed run replay",
    "/actions/runs/100",
    (r) => ({ ...r, status: "completed" }),
  ],
  [
    "wrong actor",
    "/actions/runs/100",
    (r) => ({ ...r, actor: { login: "another" } }),
  ],
  [
    "wrong workflow source",
    "/actions/runs/100",
    (r) => ({ ...r, head_sha: merged }),
  ],
  ["no run approval", "/actions/runs/100/approvals", () => []],
  [
    "rejected approval",
    "/actions/runs/100/approvals",
    (rs) => rs.map((r) => ({ ...r, state: "rejected" })),
  ],
  [
    "foreign approval",
    "/actions/runs/100/approvals",
    (rs) =>
      rs.map((r) => ({ ...r, environments: [{ id: 99, name: "production" }] })),
  ],
  [
    "foreign PR",
    "/pulls/867",
    (r) => ({ ...r, head: { ...r.head, repo: { id: 1 } } }),
  ],
  [
    "moved PR",
    "/pulls/867",
    (r) => ({ ...r, head: { ...r.head, sha: merged } }),
  ],
  [
    "diverged base",
    `/compare/${base}...${candidate}`,
    () => ({ status: "diverged", behind_by: 1 }),
  ],
  [
    "existing hold branch",
    `/git/matching-refs/heads/${target.holdBranch}`,
    () => [{ ref: target.holdBranch }],
  ],
])
  test(`refuses ${name} before any mutation`, async () => {
    const f = controllerFixture();
    f.state.apiChanges.set(path, change);
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(f.state.writes, []);
  });

test("prepare records maintenance without merging or applying schema", async () => {
  const f = controllerFixture();
  const result = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(result.phase, "prepared");
  assert.equal(result.controller, candidate);
  assert.equal(result.schema.count, 688);
  assert.equal(f.state.blocked, true);
  assert.equal(f.state.domain, target.holdBranch);
  assert.equal(f.state.alias, "dpl_Maintenance");
  assert.equal(f.state.current, base);
  assert.equal(
    f.state.writes.filter((r) => r.kind === "guard" && !r.enabled).length,
    0,
  );
});

test("complete binds merge controller and restores only retention before reopening", async () => {
  const f = controllerFixture("complete");
  const result = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(result.phase, "completed");
  assert.equal(result.candidate, candidate);
  assert.equal(result.controller, merged);
  assert.equal(result.merged, merged);
  assert.equal(result.hostedAcceptance, "pending-separate-existing-workflow");
  assert.equal(f.state.domain, target.holdBranch);
  assert.equal(f.state.alias, "dpl_Application");
  assert.equal(f.state.retention, true);
  assert.equal(f.state.blocked, false);
  const writes = f.state.writes;
  assert.ok(
    writes.findIndex((r) => r.kind === "retention" && r.enabled) <
      writes.findIndex((r) => r.kind === "guard" && !r.enabled),
  );
});

test("post-reopen failure restores guard before refusing an unrelated alias", async () => {
  const f = controllerFixture("complete");
  f.state.postOpenDrift = true;
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  const reopen = f.state.writes.findIndex(
    (r) => r.kind === "guard" && !r.enabled,
  );
  assert.ok(reopen >= 0);
  assert.deepEqual(f.state.writes[reopen + 1], {
    kind: "guard",
    enabled: true,
  });
  assert.equal(f.state.blocked, true);
  assert.equal(f.state.retention, false);
  assert.equal(f.state.alias, "dpl_Unrelated");
  assert.equal(
    f.state.records.at(-1).recovery,
    "unproven-manual-reconciliation-required",
  );
});

test("early complete failure records merge identity for later trusted-run recovery", async () => {
  const f = controllerFixture("complete");
  f.state.schemaFailure = true;
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  const receipt = f.state.records.at(-1);
  assert.equal(receipt.controller, merged);
  assert.equal(receipt.merged, merged);
  assert.equal(receipt.run, "101");
  assert.equal(receipt.phase, "recovered");
  const recovery = controllerFixture("recover");
  recovery.config.prepareRun = "101";
  recovery.config.run = "102";
  recovery.dependencies.loadReceipt = async () => receipt;
  assert.equal(
    (await runDevelopmentCutover(recovery.config, recovery.dependencies)).phase,
    "recovered",
  );
  assert.equal(recovery.state.blocked, true);
});

test("premerge recovery uses candidate source; newer Development refuses all mutations", async () => {
  const f = controllerFixture("recover");
  f.config.controller = candidate;
  f.config.ref = "refs/heads/codex/reviewed-fixture";
  f.state.current = base;
  assert.equal(
    (await runDevelopmentCutover(f.config, f.dependencies)).phase,
    "recovered",
  );
  for (const phase of ["complete", "recover"]) {
    const moved = controllerFixture(phase);
    moved.state.current = "e".repeat(40);
    await assert.rejects(
      runDevelopmentCutover(moved.config, moved.dependencies),
    );
    assert.deepEqual(moved.state.writes, []);
  }
});

for (const [name, change] of [
  [
    "different tree",
    (r) => ({ ...r, commit: { tree: { sha: "f".repeat(40) } } }),
  ],
  ["squash", (r) => ({ ...r, parents: [{ sha: base }] })],
  [
    "changed parent",
    (r) => ({ ...r, parents: [{ sha: "e".repeat(40) }, { sha: candidate }] }),
  ],
])
  test(`complete rejects ${name}`, async () => {
    const f = controllerFixture("complete");
    f.state.apiChanges.set(`/commits/${merged}`, change);
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(f.state.writes, []);
  });

test("receipt expiry is relaxed only for recovery, never identity", () => {
  const r = preparedReceipt();
  const c = cutoverConfig(environment("complete"));
  assert.throws(() => validateReceipt(r, c, r.expiresAt));
  assert.doesNotThrow(() =>
    validateReceipt(r, { ...c, phase: "recover" }, r.expiresAt),
  );
  assert.throws(() =>
    validateReceipt(
      { ...r, database: "fotdmeakexgrkronxlof" },
      { ...c, phase: "recover" },
      clock,
    ),
  );
});

test("hold refuses stale alias and all active deployment pages; unrelated Production is permitted", async () => {
  const f = controllerFixture();
  f.state.alias = "dpl_Unrelated";
  await assert.rejects(holdDomain(f.vercel, "dpl_Prior"));
  assert.deepEqual(f.state.writes, []);
  let pages = 0;
  await assert.rejects(
    verifyNoCompetingDeployment(async () =>
      ++pages === 1
        ? { deployments: [], pagination: { next: 123 } }
        : {
            deployments: [
              {
                uid: "dpl_Other",
                target: null,
                meta: { githubCommitRef: "development" },
              },
            ],
            pagination: {},
          },
    ),
  );
  assert.equal(pages, 2);
  await assert.doesNotReject(
    verifyNoCompetingDeployment(async () => ({
      deployments: [
        {
          uid: "dpl_Prod",
          target: "production",
          meta: { githubCommitRef: "main" },
        },
      ],
      pagination: {},
    })),
  );
});

test("payload pins both server credentials and real worker keys from status source", () => {
  const f = controllerFixture("complete");
  const payload = applicationPayload(f.config, merged);
  assert.equal(payload.env.SUPABASE_SECRET_KEY, f.config.serverKey);
  assert.equal(payload.env.SUPABASE_SERVICE_ROLE_KEY, f.config.serverKey);
  assert.equal(
    payload.env.NEXT_PUBLIC_SUPABASE_URL,
    `https://${target.database}.supabase.co`,
  );
  assert.equal(payload.autoAssignCustomDomains, false);
  const route = readFileSync("app/api/status/route.ts", "utf8");
  for (const name of [
    "AUTO_PUBLISH_ENABLED",
    "ORG_CALENDAR_SYNC_WORKER_ENABLED",
    "ORG_SHEET_SYNC_WORKER_ENABLED",
    "PROJECT_CANCELLATION_WORKER_ENABLED",
    "PUBLIC_IMAGE_CLEANUP_ENABLED",
    "CSF_OPERATIONAL_ALERTS_ENABLED",
  ]) {
    assert.ok(route.includes(`process.env.${name}`));
    assert.equal(payload.env[name], "false");
  }
  assert.ok(route.includes("projectCancellationWorker:"));
});

test("provider resolved source and worker status refuse incompatible apps", async () => {
  const f = controllerFixture("complete");
  await runDevelopmentCutover(f.config, f.dependencies);
  const d = f.state.deployments.get("dpl_Application");
  assert.throws(() =>
    validateDeployment(
      { ...d, meta: { ...d.meta, githubCommitSha: candidate } },
      f.config,
      "application",
      merged,
    ),
  );
  await assert.rejects(
    verifyApplicationPage(
      f.config,
      { origin: "https://application.vercel.app" },
      merged,
      async () =>
        Response.json({
          service: "lets-assist",
          environment: "preview",
          version: merged,
          deep: false,
          checks: [
            {
              name: "workers",
              details: {
                csfControlMode: "database",
                csfPublicationNotifications: true,
              },
            },
          ],
        }),
    ),
  );
});

for (const key of ["publicImageCleanup", "csfOperationalAlerts"])
  test(`staged health refuses an inherited enabled ${key} worker`, async () => {
    const f = controllerFixture("complete");
    await assert.rejects(
      verifyApplicationPage(
        f.config,
        { origin: "https://application.vercel.app" },
        merged,
        async (url, options) => {
          const result = await (await f.fetcher(url, options)).json();
          result.checks[0].details[key] = true;
          return Response.json(result);
        },
      ),
      /disabled worker posture/u,
    );
  });

test("database URI rejects all libpq overrides and Production", () => {
  const uri = environment().DEVELOPMENT_DATABASE_URL;
  for (const suffix of [
    "?host=x",
    "?hostaddr=1.2.3.4",
    "?user=postgres",
    "?dbname=other",
    "?service=x",
    "?options=x",
    "?sslmode=disable",
    "#fragment",
  ])
    assert.throws(() => validateDatabaseUrl(uri + suffix));
  assert.throws(() =>
    validateDatabaseUrl(uri.replace(target.database, "fotdmeakexgrkronxlof")),
  );
  assert.throws(() =>
    validateDatabaseUrl(uri.replace("/postgres", "/template1")),
  );
  assert.doesNotThrow(() => validateDatabaseUrl(uri + "?sslmode=require"));
});

test("write probe requires read-only SQLSTATE, not arbitrary HTTP denial", async () => {
  const f = controllerFixture();
  await assert.rejects(
    probeWriteBlock(f.config, async () =>
      Response.json({ code: "42501" }, { status: 403 }),
    ),
  );
  await assert.rejects(
    probeWriteBlock(f.config, async () => new Response(null, { status: 204 })),
  );
  await assert.doesNotReject(
    probeWriteBlock(f.config, async () =>
      Response.json({ code: "25006" }, { status: 400 }),
    ),
  );
});

test("guard serializes request transactions; retention restore requires an exact catalog", () => {
  const sql = writeBlockSql(true);
  assert.ok(
    sql.indexOf("pg_advisory_xact_lock(592043,1)") < sql.indexOf("ALTER ROLE"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout='20s'"));
  assert.ok(!sql.includes("pg_terminate_backend"));
  const retention = retentionTransitionSql(versions, true);
  assert.ok(retention.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;"));
  assert.ok(
    retention.includes("WHERE jobname='retain-cron-execution-history'"),
  );
  assert.ok(retention.includes("SELECT 1/0"));
  assert.ok(retention.endsWith("COMMIT;"));
  assert.equal(
    retentionTransitionSql(versions, false),
    "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='retain-cron-execution-history';",
  );
});

test("recovery attempts retention pause and fresh probe even when either check fails", async () => {
  for (const failed of ["retention", "probe"]) {
    const f = controllerFixture("recover");
    f.receipt.retentionRestored = true;
    const calls = [];
    f.dependencies.query = (url, sql) => {
      if (sql.includes("ALTER ROLE authenticator")) calls.push("guard");
      if (sql.startsWith("SELECT cron.alter_job")) {
        calls.push("retention");
        if (failed === "retention") throw new Error("synthetic pause failure");
      }
      return f.query(url, sql);
    };
    f.dependencies.fetcher = async (url, options) => {
      if (String(url).includes("/rest/v1/")) {
        calls.push("probe");
        if (failed === "probe") throw new Error("synthetic network failure");
      }
      return f.fetcher(url, options);
    };
    await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
    assert.deepEqual(calls, ["guard", "retention", "probe"]);
    assert.equal(f.state.blocked, true);
    assert.equal(
      f.state.writes.filter((row) => row.kind === "vercel").length,
      0,
    );
  }
});

test("a recovered complete phase reuses its recorded app instead of creating another", async () => {
  const f = controllerFixture("complete");
  f.state.postOpenDrift = true;
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  const previous = f.state.records.at(-1);
  f.state.postOpenDrift = false;
  f.state.alias = "dpl_Maintenance";
  previous.phase = "recovered";
  previous.recovery = "maintenance-with-postgrest-request-guard";
  f.config.run = "102";
  f.dependencies.loadReceipt = async () => previous;
  const before = f.state.writes.filter(
    (row) => row.path === "/v13/deployments",
  ).length;
  assert.equal(
    (await runDevelopmentCutover(f.config, f.dependencies)).phase,
    "completed",
  );
  assert.equal(
    f.state.writes.filter((row) => row.path === "/v13/deployments").length,
    before,
  );
});

test("a genuine recovery receipt remains valid for a subsequent complete run", async () => {
  const f = controllerFixture("recover");
  const receipt = await runDevelopmentCutover(f.config, f.dependencies);
  assert.equal(receipt.phase, "recovered");
  assert.equal(receipt.recovery, "maintenance-with-postgrest-request-guard");
  assert.doesNotThrow(() =>
    validateReceipt(
      receipt,
      { ...f.config, phase: "complete", prepareRun: receipt.run },
      clock,
    ),
  );
});

test("maintenance creation refuses an unrecorded candidate deployment older than approval expiry", async () => {
  const f = controllerFixture("prepare");
  f.dependencies.vercel = (path, ...rest) =>
    path.startsWith("/v6/deployments?") && path.includes("&since=")
      ? (assert.ok(path.includes("&since=0")),
        Promise.resolve({
          deployments: [
            {
              uid: "dpl_Unknown",
              created: clock - 86_400_000,
              meta: {
                developmentCandidate: candidate,
                developmentCutover: "maintenance",
              },
            },
          ],
          pagination: {},
        }))
      : f.vercel(path, ...rest);
  await assert.rejects(
    runDevelopmentCutover(f.config, f.dependencies),
    /prior cutover deployment exists/u,
  );
  assert.deepEqual(f.state.writes, []);
});

test("unknown earlier app creation refuses duplicate creation and keeps maintenance", async () => {
  const f = controllerFixture("complete");
  f.dependencies.vercel = (path, ...rest) =>
    path.startsWith("/v6/deployments?") && path.includes("&since=")
      ? Promise.resolve({
          deployments: [
            {
              id: "dpl_Unknown",
              meta: {
                developmentCandidate: candidate,
                developmentCutover: "application",
              },
            },
          ],
          pagination: {},
        })
      : f.vercel(path, ...rest);
  await assert.rejects(runDevelopmentCutover(f.config, f.dependencies));
  assert.equal(
    f.state.writes.some((row) => row.path === "/v13/deployments"),
    false,
  );
  assert.equal(f.state.blocked, true);
  assert.equal(f.state.alias, "dpl_Maintenance");
});
