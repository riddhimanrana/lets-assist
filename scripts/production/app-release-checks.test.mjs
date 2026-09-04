import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  expectedVersions,
  productionRef,
  readJson,
  requireSha,
  ReleaseCheckError,
  safeFailureMessage,
  verifyAcceptance,
  verifyLedger,
  verifyQualityRuns,
  verifySchema,
  verifySource,
} from "./app-release-checks.mjs";
import { smoke, validateStatus } from "./app-release-smoke.mjs";

const sha = "a".repeat(40);
test("release diagnostics expose only controller-owned failure messages", () => {
  assert.equal(
    safeFailureMessage(new ReleaseCheckError("Invalid release SHA.")),
    "Invalid release SHA.",
  );
  assert.doesNotMatch(
    safeFailureMessage(new Error("private provider payload")),
    /private provider payload/u,
  );
  assert.doesNotMatch(
    safeFailureMessage({ message: "private token" }),
    /private token/u,
  );
});
const repository = "example/application";
const trustedStatus = {
  state: "success",
  creator: { login: "github-actions[bot]" },
  target_url: `https://github.com/${repository}/actions/runs/42`,
};
const trustedRun = {
  id: 42,
  path: ".github/workflows/csf-hosted-development-acceptance.yml",
  head_sha: sha,
  head_branch: "development",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  status: "completed",
  conclusion: "success",
  event: "workflow_dispatch",
};
const statusBody = () => ({
  version: sha,
  environment: "production",
  deep: true,
  checks: [
    { name: "environment", state: "pass", critical: true },
    { name: "database", state: "pass", critical: true },
    { name: "tables-deep", state: "pass", critical: false },
    {
      name: "workers",
      details: {
        csfWorkbookRefresh: false,
        csfImportCommit: false,
        csfCommunications: false,
        csfScheduledPostPublisher: false,
      },
    },
  ],
});

test("release SHA accepts only a full lowercase commit", () => {
  assert.equal(requireSha(sha), sha);
  for (const value of [
    "main",
    "HEAD",
    "-h",
    sha.toUpperCase(),
    "a".repeat(39),
    undefined,
  ]) {
    assert.throws(() => requireSha(value));
  }
});

test("hosted acceptance is tied to trusted workflow, source, and repository", () => {
  verifyAcceptance(trustedStatus, trustedRun, sha, repository);
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { conclusion: "failure" },
    { status: "in_progress" },
    { path: ".github/workflows/other.yml" },
    { head_branch: "main" },
    { event: "pull_request" },
    { head_repository: { full_name: "fork/application" } },
  ]) {
    assert.throws(() =>
      verifyAcceptance(
        trustedStatus,
        { ...trustedRun, ...patch },
        sha,
        repository,
      ),
    );
  }
  assert.throws(() =>
    verifyAcceptance(
      { ...trustedStatus, creator: { login: "operator" } },
      trustedRun,
      sha,
      repository,
    ),
  );
  assert.throws(() =>
    verifyAcceptance(
      { ...trustedStatus, target_url: "https://untrusted.test/42" },
      trustedRun,
      sha,
      repository,
    ),
  );
});

test("latest trusted quality and database checks must both succeed", () => {
  const runs = ["quality", "db-replay-validation"].map((name, id) => ({
    name,
    id,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions" },
  }));
  verifyQualityRuns(runs);
  assert.throws(() => verifyQualityRuns(runs.slice(0, 1)));
  assert.throws(() =>
    verifyQualityRuns([
      ...runs,
      { ...runs[0], id: 100, conclusion: "failure" },
    ]),
  );
  assert.throws(() =>
    verifyQualityRuns(
      runs.map((run) => ({ ...run, app: { slug: "untrusted" } })),
    ),
  );
});

test("source verification pins clean Git trees and the required CI workflow", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "csf-app-source-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fictional fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "Accepted fixture");
  const acceptedSha = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-m", "Release fixture");
  const releaseSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  const config = {
    cwd,
    releaseSha,
    acceptedSha,
    repository,
    token: "fictional-token",
  };
  let ciPatch = {};
  const fetcher = async (url) => {
    if (url.endsWith("/status"))
      throw new Error("The combined-status endpoint omits the status creator.");
    if (url.endsWith("/statuses?per_page=100"))
      return Response.json([
        {
          ...trustedStatus,
          id: 1,
          context: "csf-hosted-development-acceptance",
        },
      ]);
    if (url.endsWith("/actions/runs/42"))
      return Response.json({ ...trustedRun, head_sha: acceptedSha });
    if (url.endsWith("/check-runs?per_page=100"))
      return Response.json({
        total_count: 2,
        check_runs: ["quality", "db-replay-validation"].map((name, id) => ({
          name,
          id,
          status: "completed",
          conclusion: "success",
          app: { slug: "github-actions" },
          details_url: `https://github.com/${repository}/actions/runs/43/job/${id}`,
        })),
      });
    if (url.endsWith("/actions/runs/43"))
      return Response.json({
        ...trustedRun,
        id: 43,
        head_sha: acceptedSha,
        path: ".github/workflows/ci.yml",
        ...ciPatch,
      });
    throw new Error("Unexpected request");
  };
  assert.equal((await verifySource(config, fetcher)).releaseSha, releaseSha);
  for (const patch of [
    { path: ".github/workflows/untrusted.yml" },
    { head_sha: releaseSha },
    { conclusion: "failure" },
    { head_repository: { full_name: "fork/application" } },
  ]) {
    ciPatch = patch;
    await assert.rejects(verifySource(config, fetcher));
  }
  ciPatch = {};
  writeFileSync(resolve(cwd, "fixture.txt"), "fictional fixture");
  await assert.rejects(verifySource(config, fetcher), /not clean/u);
  git("add", "fixture.txt");
  git("commit", "-m", "Changed application fixture");
  const changedSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", changedSha);
  await assert.rejects(
    verifySource({ ...config, releaseSha: changedSha }, fetcher),
    /tree differs/u,
  );
});

test("migration equality includes missing, unexpected, duplicate, and reordered entries", () => {
  const expected = ["20260101000000", "20260102000000"];
  verifyLedger(
    expected.map((version) => ({ version })),
    expected,
  );
  for (const actual of [
    expected.slice(0, 1),
    [...expected, expected[1]],
    [...expected].reverse(),
    [expected[0], "20260103000000"],
  ]) {
    assert.throws(() =>
      verifyLedger(
        actual.map((version) => ({ version })),
        expected,
      ),
    );
  }
});

test("schema verification uses only fixed read-only management requests", async () => {
  const cwd = resolve(import.meta.dirname, "../..");
  const versions = expectedVersions(cwd);
  const responses = [
    versions.map((version) => ({ version })),
    [{ csf_target_schema_verified: 1 }],
    [{ valid: true }],
    [{ valid: true }],
  ];
  const calls = [];
  const result = await verifySchema(
    { projectRef: productionRef, token: "fictional-token", cwd },
    async (url, options) => {
      calls.push({ url, options });
      return Response.json(responses.shift());
    },
  );
  assert.equal(result.migrations, versions.length);
  assert.equal(calls.length, 4);
  for (const { url, options } of calls) {
    assert.equal(
      url,
      `https://api.supabase.com/v1/projects/${productionRef}/database/query/read-only`,
    );
    assert.equal(options.redirect, "error");
    assert.match(
      JSON.parse(options.body)
        .query.replace(/^--.*$/gmu, "")
        .trim(),
      /^(SELECT|WITH)\b/u,
    );
  }
  assert.match(JSON.parse(calls[1].options.body).query, /foreign_key_posture/u);
  assert.match(
    JSON.parse(calls[1].options.body).query,
    /function_fragment_posture/u,
  );
  await assert.rejects(
    verifySchema({ projectRef: "wrong-project", token: "x", cwd }, () => {
      throw new Error("must not call");
    }),
  );
});

test("catalog refusal and active write block stop deployment", async () => {
  const cwd = resolve(import.meta.dirname, "../..");
  for (const index of [1, 2, 3]) {
    const responses = [
      expectedVersions(cwd).map((version) => ({ version })),
      [{ csf_target_schema_verified: 1 }],
      [{ valid: true }],
      [{ valid: true }],
    ];
    responses[index] = [{ valid: false, csf_target_schema_verified: 0 }];
    await assert.rejects(
      verifySchema({ projectRef: productionRef, token: "x", cwd }, async () =>
        Response.json(responses.shift()),
      ),
    );
  }
});

test("transport errors never repeat provider content or follow redirects", async () => {
  await assert.rejects(
    readJson(
      "https://example.test",
      {},
      async () => new Response("private provider payload", { status: 403 }),
    ),
    { message: "Release verification refused: HTTP 403." },
  );
  await assert.rejects(
    readJson("https://example.test", {}, async () => {
      throw new Error("private credential");
    }),
    { message: "Release verification transport failed." },
  );
});

test("smoke requires exact source, healthy deep checks, and disabled workers", () => {
  validateStatus(statusBody(), sha);
  for (const patch of [
    { version: "b".repeat(40) },
    { environment: "preview" },
    { deep: false },
  ]) {
    assert.throws(() => validateStatus({ ...statusBody(), ...patch }, sha));
  }
  for (const key of Object.keys(statusBody().checks.at(-1).details)) {
    const status = statusBody();
    status.checks.at(-1).details[key] = true;
    assert.throws(() => validateStatus(status, sha));
  }
  const status = statusBody();
  status.checks[2].state = "fail";
  assert.throws(() => validateStatus(status, sha));
});

test("smoke checks login and refuses public protected-route content", async () => {
  const config = {
    origin: "https://fixture.vercel.app",
    expectedSha: sha,
    bypass: "fictional-bypass",
  };
  const responses = [
    Response.json(statusBody()),
    new Response("Login"),
    new Response(null, {
      status: 307,
      headers: { location: "/login?next=protected" },
    }),
  ];
  const result = await smoke(config, async (url, options) => {
    assert.equal(url.origin, config.origin);
    assert.equal(options.redirect, "manual");
    return responses.shift();
  });
  assert.equal(result.protectedRoute, "requires_authentication");
  await assert.rejects(smoke({ ...config, origin: "https://foreign.test" }));
  const invalid = [
    Response.json(statusBody()),
    new Response("Login"),
    new Response("Protected content"),
  ];
  await assert.rejects(smoke(config, async () => invalid.shift()));
});

test("app-only workflow cannot execute a migration or import command", () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, "../../.github/workflows/deploy-app-only.yml"),
    "utf8",
  );
  assert.doesNotMatch(
    workflow,
    /supabase db (push|reset|dump)|apply_migration|set-application-write-block|recovery_capture|PRODUCTION_READONLY_URL|csf_queue_import/u,
  );
  assert.equal((workflow.match(/vercel@59\.3\.0 build /gu) ?? []).length, 1);
  assert.match(workflow, /deploy --prebuilt --prod --skip-domain/u);
  assert.match(workflow, /group: production-schema-deployment/u);
  assert.match(workflow, /environment: production/u);
  assert.match(
    workflow,
    /name: Verify exact public alias and application[\s\S]*?VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/u,
  );
  assert.match(workflow, /always\(\).*steps\.promote\.outcome/u);
  assert.ok(
    workflow.indexOf("Retain count-only recovery receipt") <
      workflow.indexOf("name: Promote staged application"),
  );
  assert.match(workflow, /ref: \$\{\{ inputs.release_sha \}\}/u);
  assert.doesNotMatch(workflow, /path:.*\.vercel\/output/u);
});
