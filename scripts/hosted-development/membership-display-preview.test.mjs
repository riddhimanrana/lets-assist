import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { membershipPolicy as p } from "../production/membership-display-source.mjs";
import {
  createMembershipPreview,
  checkMembershipPreview,
  checkMembershipProductionBaseline,
  membershipAcceptanceOrigin,
  membershipPreviewPayload,
  verifyMembershipPreview,
  verifyPreviewReceipt,
  developmentCatalogQuery,
  verifyMembershipPreviewStatus,
} from "./membership-display-preview.mjs";
import { shouldRunVercelBuild } from "../vercel-build-policy.mjs";
import {
  buildSyntheticAccounts,
  fixtureOrganizationPath,
  FIXTURE_MARKER,
} from "./csf-load-fixture.mjs";

const config = { sha: "a".repeat(40), run: "123" };
function deployment() {
  return {
    id: "dpl_Fictional",
    url: "fictional-preview.vercel.app",
    target: null,
    projectId: p.project,
    gitSource: { sha: config.sha, ref: "main", repoId: p.repositoryId },
    meta: {
      membershipDisplaySha: config.sha,
      membershipDisplayRun: config.run,
    },
    alias: ["fictional-preview.vercel.app"],
  };
}
function receipt() {
  return {
    ...verifyMembershipPreview(deployment(), config),
    project: p.project,
    database: p.database,
    development: p.development,
    priorProduction: "dpl_Prior",
    priorDevelopment: "dpl_Development",
    readiness: "READY",
  };
}
test("Preview explicitly prevents domain assignment and has only nonsecret context overrides", () => {
  const value = membershipPreviewPayload(config);
  assert.equal(value.autoAssignCustomDomains, false);
  assert.equal(value.target, undefined);
  assert.equal(value.gitSource.sha, config.sha);
  assert.equal(value.gitSource.ref, "main");
  assert.equal(value.env.SUPABASE_PROJECT_ID, p.database);
  assert.equal(value.env.CSF_SHEET_WRITEBACK_ENABLED, "false");
  assert.equal(value.env.ORG_SHEET_SYNC_WORKER_ENABLED, "false");
  assert.equal(value.env.ORG_CALENDAR_SYNC_WORKER_ENABLED, "false");
  assert.equal(value.env.AUTO_PUBLISH_ENABLED, "false");
  assert.equal(value.env.PROJECT_CANCELLATION_WORKER_ENABLED, "false");
  assert.equal(value.env.ORGANIZATION_SHEET_SYNC_ENABLED, undefined);
  assert.equal(value.env.CSF_WORKER_CONTROL_MODE, "environment");
  assert.equal(value.env.LETS_ASSIST_EXPLICIT_MEMBERSHIP_SHA, config.sha);
  for (const key of Object.keys(value.env))
    assert.doesNotMatch(key, /KEY|PASSWORD|TOKEN|SECRET/u);
  assert.deepEqual(value.env, value.build.env);
});
for (const [field, value] of Object.entries({
  id: "wrong",
  url: "lets-assist.com",
  projectId: "prj_Other",
  target: "production",
  gitSource: { sha: "b".repeat(40), ref: "main", repoId: p.repositoryId },
  meta: { membershipDisplaySha: config.sha, membershipDisplayRun: "124" },
  alias: ["dev.lets-assist.com"],
}))
  test("rejects changed immutable deployment " + field, () =>
    assert.throws(() =>
      verifyMembershipPreview({ ...deployment(), [field]: value }, config),
    ),
  );
test("rejects SHA mismatch, changed repository/ref and different existing deployment ID", () => {
  for (const source of [
    { sha: "b".repeat(40), ref: "main", repoId: p.repositoryId },
    { sha: config.sha, ref: "development", repoId: p.repositoryId },
    { sha: config.sha, ref: "main", repoId: "1" },
  ])
    assert.throws(() =>
      verifyMembershipPreview({ ...deployment(), gitSource: source }, config),
    );
  assert.throws(() =>
    verifyMembershipPreview(deployment(), config, "dpl_Other"),
  );
});
test("receipt binds immutable origin to exact source/run/nonproduction backend and both aliases", () =>
  verifyPreviewReceipt(receipt(), config));
for (const [field, value] of Object.entries({
  sha: "b".repeat(40),
  run: "124",
  database: "fotdmeakexgrkronxlof",
  project: "prj_Other",
  development: "b".repeat(40),
  deploymentId: "wrong",
  readiness: "pending",
  priorProduction: "wrong",
  priorDevelopment: "wrong",
}))
  test("rejects changed receipt " + field, () =>
    assert.throws(() =>
      verifyPreviewReceipt({ ...receipt(), [field]: value }, config),
    ),
  );
for (const origin of [
  "https://lets-assist.com",
  "http://fictional-preview.vercel.app",
  "https://fictional-preview.vercel.app.evil.test",
  "https://user:pass@fictional-preview.vercel.app",
  "https://fictional-preview.vercel.app:444",
  "https://fictional-preview.vercel.app/path",
  "https://fictional-preview.vercel.app/?secret=value",
  "https://fictional-preview.vercel.app/#fragment",
])
  test("refuses unreviewed target " + origin, () =>
    assert.throws(() => verifyPreviewReceipt({ ...receipt(), origin }, config)),
  );
test("default hosted target remains Development and cannot be overridden by an origin alone", () =>
  assert.equal(
    membershipAcceptanceOrigin({ CSF_APP_URL: "https://evil.test" }),
    "https://dev.lets-assist.com",
  ));

test("only an owned regular receipt in the protected full-mode job can select the immutable origin", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "membership-origin-"));
  const previous = process.cwd();
  const environment = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: p.repository,
    GITHUB_REPOSITORY_ID: p.repositoryId,
    GITHUB_WORKFLOW_REF: p.repository + "/" + p.workflow + "@refs/heads/main",
    RELEASE_SHA: config.sha,
    GITHUB_SHA: config.sha,
    GITHUB_RUN_ID: config.run,
    GH_TOKEN: "fictional",
    CONFIRMATION: "deploy-membership-display:" + config.sha,
    FIXTURE_CONFIRMATION: "test-existing-development-fixture:" + config.sha,
    CSF_HOSTED_ACCEPTANCE_MODE: "full",
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: p.database,
    CSF_MEMBERSHIP_PREVIEW_RECEIPT:
      ".artifacts/membership-display-preview.json",
  };
  try {
    process.chdir(directory);
    mkdirSync(".artifacts");
    const path = environment.CSF_MEMBERSHIP_PREVIEW_RECEIPT;
    writeFileSync(path, JSON.stringify(receipt()), { mode: 0o600 });
    assert.equal(
      membershipAcceptanceOrigin(environment),
      "https://fictional-preview.vercel.app",
    );
    assert.throws(() =>
      membershipAcceptanceOrigin({
        ...environment,
        CSF_HOSTED_ACCEPTANCE_MODE: "functional",
      }),
    );
    assert.throws(() =>
      membershipAcceptanceOrigin({
        ...environment,
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "fotdmeakexgrkronxlof",
      }),
    );
    chmodSync(path, 0o666);
    assert.throws(() => membershipAcceptanceOrigin(environment));
    rmSync(path);
    writeFileSync("other.json", JSON.stringify(receipt()));
    symlinkSync(resolve("other.json"), path);
    assert.throws(() => membershipAcceptanceOrigin(environment));
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});
test("explicit membership build is limited to exact Main Preview; other build paths keep their policy", () => {
  const input = {
    branch: "main",
    environment: "preview",
    commitSha: config.sha,
    explicitMembershipSha: config.sha,
  };
  assert.equal(shouldRunVercelBuild(input), true);
  for (const change of [
    { branch: "other" },
    { environment: "production" },
    { commitSha: "b".repeat(40) },
    { explicitMembershipSha: undefined },
  ])
    assert.equal(shouldRunVercelBuild({ ...input, ...change }), false);
});
test("database query is pinned to reviewed Development catalog, explicit read-only transaction and hashes", () => {
  const sql = developmentCatalogQuery(process.cwd());
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(sql, /count\(\*\)=729/u);
  assert.match(
    sql,
    /5683053e8fc69f99c841ece8d1c0f8447dba68a933369692a94ae1fc0703e90c/u,
  );
  assert.match(
    sql,
    /2540b33e3aab056607685cdb316ef3aa34930b74e4db9b5385cfd680381c652d/u,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|COPY)\s+(?:INTO|FROM|TABLE|ROLE)/u,
  );
});
test("catalog builder refuses altered committed baseline bytes", () =>
  assert.throws(() => developmentCatalogQuery("/unused", () => "{}")));
test("load script retains every functional/performance threshold with only its target proof extended", () => {
  const source = readFileSync(
    new URL("./test-csf-load.mjs", import.meta.url),
    "utf8",
  );
  for (const text of [
    "mutationCount",
    "BROWSER_REVIEW_NAVIGATIONS = 25",
    "DEFAULT_DURATION_MS = 15 * 60 * 1000",
    "result.readP95Ms <= 2_500",
    "result.mutationP95Ms <= 3_000",
    "PRODUCTION_PROJECT_REF",
    "membershipAcceptanceOrigin(process.env)",
  ])
    assert.ok(source.includes(text), text);
});
test("acceptance keeps the existing fixed synthetic identities, fixture route and bounded preference operations", () => {
  const accounts = buildSyntheticAccounts();
  assert.equal(accounts.members.length, 90);
  assert.equal(accounts.officers.length, 10);
  assert.equal(
    new Set(
      [...accounts.members, ...accounts.officers].map((a) => a.authUserId),
    ).size,
    100,
  );
  for (const [role, pool] of [
    ["member", accounts.members],
    ["officer", accounts.officers],
  ])
    for (const account of pool) {
      assert.equal(account.role, role);
      assert.match(
        account.email,
        new RegExp("^" + role + "-[0-9]{3}@csf-load\\.local\\.test$", "u"),
      );
    }
  assert.equal(fixtureOrganizationPath(), "/organization/csf-load-fixture");
  assert.equal(FIXTURE_MARKER, "csf-hosted-load-fixture/v1");
  const load = readFileSync(
    new URL("./test-csf-load.mjs", import.meta.url),
    "utf8",
  );
  for (const text of [
    "email: account.email",
    "payload.sub.toLowerCase() !== expectedAccount.authUserId.toLowerCase()",
    "payload.app_metadata?.csf_hosted_load_fixture !== true",
    "payload.app_metadata?.organization_handle !== FIXTURE_ORGANIZATION_HANDLE",
    "payload.app_metadata?.fixture_contract !== FIXTURE_MARKER",
    "location.pathname !== fixtureOrganizationPath()",
    "const BROWSER_WARMUP_SAMPLES = 5",
    "const BROWSER_MEASURED_SAMPLES = 30",
    "if (await restoreOfficerButton.isVisible())",
  ])
    assert.ok(load.includes(text), text);
  assert.doesNotMatch(
    load,
    /auth\.admin\.|\.signUp\(|provision-csf|\.insert\(|\.upsert\(/u,
  );
});

function healthyStatus() {
  return {
    service: "lets-assist",
    status: "degraded",
    environment: "preview",
    version: config.sha,
    deep: true,
    checks: [
      { name: "environment", state: "pass", critical: true },
      { name: "database", state: "pass", critical: true },
      { name: "tables-deep", state: "pass", critical: false },
      {
        name: "workers",
        state: "warn",
        critical: false,
        details: {
          autoPublishHours: false,
          csfCommunications: false,
          csfImportCommit: false,
          csfPublicationNotifications: false,
          csfScheduledPostPublisher: false,
          csfWorkbookRefresh: false,
          organizationCalendarSync: false,
          organizationSheetSync: false,
          projectCancellationWorker: false,
          csfControlMode: "environment",
        },
      },
    ],
  };
}
test("only the all-disabled worker warning is accepted, with healthy environment/database/deep tables", () => {
  verifyMembershipPreviewStatus(healthyStatus(), config);
  for (const name of ["environment", "database", "tables-deep"])
    for (const state of ["warn", "fail"]) {
      const status = healthyStatus();
      status.checks.find((c) => c.name === name).state = state;
      assert.throws(() => verifyMembershipPreviewStatus(status, config));
    }
  for (const change of [
    { checks: [] },
    { checks: null },
    { status: "operational" },
    { status: "outage" },
    { environment: "production" },
    { version: "b".repeat(40) },
    { deep: false },
  ])
    assert.throws(() =>
      verifyMembershipPreviewStatus({ ...healthyStatus(), ...change }, config),
    );
  const duplicated = healthyStatus();
  duplicated.checks.push(duplicated.checks[0]);
  assert.throws(() => verifyMembershipPreviewStatus(duplicated, config));
});
for (const flag of Object.keys(healthyStatus().checks.at(-1).details))
  test("refuses missing or enabled Preview worker detail " + flag, () => {
    const status = healthyStatus();
    status.checks.at(-1).details[flag] =
      flag === "csfControlMode" ? "database" : true;
    assert.throws(() => verifyMembershipPreviewStatus(status, config));
    delete status.checks.at(-1).details[flag];
    assert.throws(() => verifyMembershipPreviewStatus(status, config));
  });

function providerFixture({
  loseCreate = false,
  moveAlias = false,
  wrongSha = false,
  baselineMove = false,
  unhealthy = false,
} = {}) {
  const calls = [],
    records = [];
  let creates = 0;
  const config = {
    sha: "a".repeat(40),
    run: "123",
    repository: p.repository,
    repositoryId: p.repositoryId,
    projectId: p.project,
    teamId: p.team,
    productionAppSha: p.productionApp,
    vercelToken: "fictional-provider-token",
    accessToken: "fictional-read-token",
    bypass: "fictional-bypass",
  };
  const json = (value) => new Response(JSON.stringify(value), { status: 200 });
  const fetcher = async (url, options = {}) => {
    const u = new URL(String(url)),
      method = options.method ?? "GET";
    calls.push({ path: u.pathname, method });
    if (u.hostname === "api.supabase.com") {
      assert.equal(
        u.pathname,
        "/v1/projects/" + p.database + "/database/query/read-only",
      );
      assert.equal(method, "POST");
      assert.match(JSON.parse(options.body).query, /READ ONLY/u);
      return json([{ valid: true }]);
    }
    if (u.hostname === "fictional-preview.vercel.app") {
      const status = healthyStatus();
      if (unhealthy)
        status.checks.find((c) => c.name === "database").state = "fail";
      return json(status);
    }
    assert.equal(u.hostname, "api.vercel.com");
    if (u.pathname === "/v4/aliases")
      return json({
        aliases: [
          {
            alias: "lets-assist.com",
            projectId: p.project,
            deploymentId:
              baselineMove || (moveAlias && creates)
                ? "dpl_Other"
                : "dpl_Prior",
          },
        ],
      });
    if (
      u.pathname === "/v13/deployments/dpl_Prior" ||
      u.pathname === "/v13/deployments/dpl_Other"
    )
      return json({
        id: u.pathname.split("/").at(-1),
        projectId: p.project,
        target: "production",
        readyState: "READY",
        meta: {
          githubCommitSha: wrongSha ? "b".repeat(40) : p.productionApp,
          githubOrg: "riddhimanrana",
          githubRepo: "lets-assist",
        },
        gitSource: {
          sha: wrongSha ? "b".repeat(40) : p.productionApp,
          repoId: p.repositoryId,
        },
      });
    if (u.pathname === "/v4/aliases/dev.lets-assist.com")
      return json({ projectId: p.project, deploymentId: "dpl_Development" });
    if (u.pathname === "/v13/deployments/dpl_Development")
      return json({
        projectId: p.project,
        target: null,
        meta: { githubCommitSha: p.development },
      });
    if (u.pathname === "/v9/projects/" + p.project)
      return json({
        id: p.project,
        accountId: p.team,
        link: { repoId: p.repositoryId, productionBranch: "main" },
      });
    if (u.pathname === "/v13/deployments" && method === "POST") {
      creates++;
      assert.equal(JSON.parse(options.body).autoAssignCustomDomains, false);
      if (loseCreate) throw new Error("fictional lost response");
      return json(deployment());
    }
    if (u.pathname === "/v13/deployments/dpl_Fictional")
      return json({ ...deployment(), readyState: "READY" });
    assert.fail("Unexpected provider operation: " + method + " " + u.pathname);
  };
  return {
    config,
    calls,
    records,
    fetcher,
    record: (value) => records.push(value),
    creates: () => creates,
  };
}
test("real Preview orchestration creates once, records before waiting and never writes aliases", async () => {
  const v = providerFixture();
  const receipt = await createMembershipPreview(v.config, v);
  assert.equal(v.creates(), 1);
  assert.equal(receipt.readiness, "READY");
  assert.deepEqual(
    v.records.map((r) => r.readiness),
    ["pending", "READY"],
  );
  assert.equal(
    v.calls.filter(
      (c) => c.method === "POST" && c.path.startsWith("/v4/aliases"),
    ).length,
    0,
  );
  assert.ok(
    v.calls.every(
      (c) =>
        c.method === "GET" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("unknown create outcome is never retried and cannot produce a ready receipt", async () => {
  const v = providerFixture({ loseCreate: true });
  await assert.rejects(createMembershipPreview(v.config, v), /unproved/u);
  assert.equal(v.creates(), 1);
  assert.deepEqual(v.records, []);
});
test("a moved shared alias refuses acceptance after creation without overwriting it", async () => {
  const v = providerFixture({ moveAlias: true });
  await assert.rejects(createMembershipPreview(v.config, v), /refused/u);
  assert.equal(v.creates(), 1);
  assert.ok(
    v.calls.every(
      (c) =>
        c.method !== "POST" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("each Production baseline check requires both the pinned app SHA and the hosted receipt's exact deployment", async () => {
  const v = providerFixture();
  assert.equal(
    await checkMembershipProductionBaseline(v.config, receipt(), v.fetcher),
    "dpl_Prior",
  );
  const moved = providerFixture({ baselineMove: true });
  await assert.rejects(
    checkMembershipProductionBaseline(moved.config, receipt(), moved.fetcher),
  );
  const wrong = providerFixture({ wrongSha: true });
  await assert.rejects(
    checkMembershipProductionBaseline(wrong.config, receipt(), wrong.fetcher),
  );
  assert.ok(
    [...v.calls, ...moved.calls, ...wrong.calls].every(
      (c) => c.method === "GET",
    ),
  );
});
test("unhealthy Preview refuses actual orchestration without retry or alias writes", async () => {
  const v = providerFixture({ unhealthy: true });
  await assert.rejects(createMembershipPreview(v.config, v));
  assert.equal(v.creates(), 1);
  assert.ok(
    v.calls.every(
      (c) =>
        c.method !== "POST" ||
        c.path === "/v13/deployments" ||
        c.path.endsWith("/database/query/read-only"),
    ),
  );
});
test("a fresh check after a hypothetical review wait refuses a moved baseline", async () => {
  const v = providerFixture({ baselineMove: true });
  await assert.rejects(checkMembershipPreview(v.config, receipt(), v));
  assert.equal(v.creates(), 0);
});
