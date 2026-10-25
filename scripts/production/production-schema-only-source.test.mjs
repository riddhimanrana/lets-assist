import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readReviewedHotfixFile } from "./historical-hotfix-test-fixture.mjs";
import {
  verifyDeploymentIdentity,
  verifyLiveProductionApp,
  verifyReviewedContent,
  verifyReviewedPaths,
  verifySchemaOnlySource,
} from "./production-schema-only-source.mjs";

const repo = "example/application";
const repoId = "123";
const projectId = "prj_test";
const teamId = "team_test";
const deploymentId = "dpl_Fictional";
const migration =
  "supabase/migrations/20261013071100_csf_repeatable_pending_activity_claims.sql";
const reviewedFiles = [
  ".github/workflows/deploy-forward-migrations.yml",
  "docs/README.md",
  "docs/development/production-points-schema-hotfix.md",
  "scripts/production/app-release-catalog.mjs",
  "scripts/production/app-release-checks.mjs",
  "scripts/production/csf-repeatable-pending-claims-catalog.test.mjs",
  "scripts/production/final-schema-688.json",
  "scripts/production/final-schema-manifest.md",
  "scripts/production/forward-migration-allowlist.mjs",
  "scripts/production/forward-migration-historical-tails.test.mjs",
  "scripts/production/forward-migration-release-fixture.mjs",
  "scripts/production/migration-digests.mjs",
  "scripts/production/production-schema-only-source.mjs",
  "scripts/production/production-schema-only-source.test.mjs",
  migration,
  "supabase/tests/database/csf_fixed_activity_submission_uniqueness.test.sql",
];
const deployment = (appSha) => ({
  id: deploymentId,
  projectId,
  target: "production",
  readyState: "READY",
  meta: { appOnlyReleaseSha: appSha, appOnlyReleaseRun: "42" },
  gitSource: { sha: appSha, repoId },
});
const alias = (id = deploymentId) => ({
  aliases: [{ alias: "lets-assist.com", projectId, deploymentId: id }],
});

test("the combined release cannot reuse the one-time schema hotfix approval", () => {
  assert.throws(
    () => verifyReviewedContent(new URL("../../", import.meta.url).pathname),
    /exact reviewed hotfix/u,
  );
});

test("reviewed forward workflow binds the alternate gate without changing mutation controls", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/deploy-forward-migrations.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /production-schema-deployment/u);
  assert.match(
    workflow,
    /schema-only:\$\{PRODUCTION_APP_SHA\}:\$\{RELEASE_SHA\}/u,
  );
  assert.match(
    workflow,
    /\[\[ "\$\{RELEASE_SHA\}" == "\$\{GITHUB_SHA\}" \]\]/u,
  );
  assert.match(workflow, /verify-vercel-project\.sh/u);
  assert.match(
    workflow,
    /production-schema-only-source\.mjs \| tee \.artifacts\/source-verification\.json/u,
  );
  assert.match(
    workflow,
    /\[\[ "\$\(git hash-object \.\.\/scripts\/production\/production-schema-only-source\.mjs\)" == "\$\{SCHEMA_ONLY_VERIFIER_BLOB\}" \]\]/u,
  );
  assert.equal(
    (workflow.match(/production-schema-only-source\.mjs live/gu) ?? []).length,
    2,
  );
  assert.match(workflow, /forward-migration-release\.mjs/u);
  assert.doesNotMatch(
    workflow,
    /bun run build|vercel.*deploy|db (push|dump|reset)/u,
  );
});

test("workflow rejects altered imported code before executing the verifier", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "csf-schema-bootstrap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = resolve(root, "release");
  const sourceDir = resolve(root, "scripts/production");
  mkdirSync(release);
  mkdirSync(sourceDir, { recursive: true });
  const git = (...args) =>
    execFileSync("git", args, { cwd: release, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fictional fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(resolve(release, "base.txt"), "baseline\n");
  git("add", ".");
  git("commit", "-m", "Fictional deployed app");
  const productionAppSha = git("rev-parse", "HEAD");
  for (const path of reviewedFiles) {
    mkdirSync(dirname(resolve(release, path)), { recursive: true });
    writeFileSync(
      resolve(release, path),
      readReviewedHotfixFile("schema", path),
    );
  }
  git("add", ".");
  git("commit", "-m", "Fictional schema-only hotfix");
  const releaseSha = git("rev-parse", "HEAD");
  const env = {
    ...process.env,
    RELEASE_SHA: releaseSha,
    PRODUCTION_APP_SHA: productionAppSha,
  };
  for (const name of [
    "production-schema-only-source.mjs",
    "app-release-checks.mjs",
    "app-release-catalog.mjs",
  ]) {
    writeFileSync(
      resolve(sourceDir, name),
      readReviewedHotfixFile("schema", `scripts/production/${name}`),
    );
  }
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/deploy-forward-migrations.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const step = workflow
    .split(
      "      - name: Verify schema-only source, full CI and live Production app\n",
    )[1]
    .split("      - name: Retain source verification")[0];
  const body = step
    .split("        run: |\n")[1]
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  const verifierCommand =
    "node ../scripts/production/production-schema-only-source.mjs";
  assert.ok(
    body.indexOf("sha256sum ../scripts/production/app-release-checks.mjs") > 0,
  );
  assert.ok(
    body.indexOf("sha256sum ../scripts/production/app-release-catalog.mjs") > 0,
  );
  assert.ok(
    body.indexOf(verifierCommand) > body.indexOf("app-release-catalog.mjs"),
  );
  assert.ok(
    body.indexOf("cmp -s .artifacts/schema-only-changed-paths") <
      body.indexOf("SCHEMA_ONLY_VERIFIER_BLOB="),
  );
  assert.ok(
    body.indexOf("cmp -s .artifacts/schema-only-changed-paths") <
      body.indexOf(verifierCommand),
  );
  execFileSync("bash", ["-c", body.slice(0, body.indexOf(verifierCommand))], {
    cwd: release,
    env,
  });
  const marker = resolve(root, "unreviewed-code-ran");
  const checks = resolve(sourceDir, "app-release-checks.mjs");
  writeFileSync(
    checks,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\n${readFileSync(checks, "utf8")}`,
  );
  assert.throws(() =>
    execFileSync("bash", ["-c", body], { cwd: release, env }),
  );
  assert.equal(existsSync(marker), false);
  writeFileSync(
    resolve(release, "scripts/production/unreviewed-catalog.mjs"),
    "unreviewed local import\n",
  );
  git("add", "scripts/production/unreviewed-catalog.mjs");
  git("commit", "-m", "Fictional unreviewed import");
  assert.throws(() =>
    execFileSync("bash", ["-c", body], {
      cwd: release,
      env: { ...env, RELEASE_SHA: git("rev-parse", "HEAD") },
    }),
  );
  assert.equal(existsSync(marker), false);
});

test("schema-only source permits only the reviewed migration and tooling", () => {
  assert.equal(verifyReviewedPaths(reviewedFiles), reviewedFiles.length);
  for (const bad of [
    reviewedFiles.filter((path) => path !== migration),
    reviewedFiles.filter(
      (path) => path !== "docs/development/production-points-schema-hotfix.md",
    ),
    [...reviewedFiles, "package.json"],
    [...reviewedFiles, "bun.lock"],
    [...reviewedFiles, "lib/plugins/private"],
    [...reviewedFiles, "app/points/page.tsx"],
    [...reviewedFiles, "supabase/migrations/20261013080000_other.sql"],
  ]) {
    assert.throws(() => verifyReviewedPaths(bad), /unreviewed change|lacks/u);
  }
});

test("Production deployment identity requires a controlled SHA and ready target", () => {
  const appSha = "a".repeat(40);
  const config = {
    productionAppSha: appSha,
    deploymentId,
    projectId,
    repositoryId: repoId,
    repository: repo,
  };
  verifyDeploymentIdentity(deployment(appSha), config);
  for (const altered of [
    { meta: {} },
    { meta: { productionReleaseSha: appSha } },
    { meta: { appOnlyReleaseSha: appSha } },
    { meta: { appOnlyReleaseSha: appSha, appOnlyReleaseRun: "0" } },
    {
      meta: {
        githubCommitSha: appSha,
        githubCommitRef: appSha,
        githubOrg: "example",
        githubRepo: "application",
      },
    },
    { gitSource: undefined },
    { gitSource: { sha: "b".repeat(40), repoId } },
    { projectId: "other" },
    { target: "preview" },
    { readyState: "BUILDING" },
    { id: "dpl_Other" },
    {
      meta: { appOnlyReleaseSha: appSha, appOnlyReleaseRun: "42" },
      gitSource: { sha: appSha, repoId: "456" },
    },
  ]) {
    assert.throws(() =>
      verifyDeploymentIdentity({ ...deployment(appSha), ...altered }, config),
    );
  }
});

test("live alias is bound twice to the exact ready deployment", async () => {
  const productionAppSha = "a".repeat(40);
  const config = {
    productionAppSha,
    projectId,
    teamId,
    repositoryId: repoId,
    repository: repo,
    vercelToken: "fictional-token",
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(
      calls.length === 2 ? deployment(productionAppSha) : alias(),
    );
  };
  assert.equal(await verifyLiveProductionApp(config, fetcher), deploymentId);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.includes("/v4/aliases?"));
  assert.ok(calls[1].url.includes(`/v13/deployments/${deploymentId}?`));
  assert.equal(
    new URL(calls[1].url).searchParams.get("withGitRepoInfo"),
    "true",
  );
  assert.equal(calls[0].options.redirect, "error");
  await assert.rejects(
    verifyLiveProductionApp(config, async (url) =>
      Response.json(
        String(url).includes("deployments")
          ? deployment(productionAppSha)
          : alias("dpl_Other"),
      ),
    ),
  );
  let count = 0;
  await assert.rejects(
    verifyLiveProductionApp(config, async () => {
      count += 1;
      return Response.json(
        count === 1
          ? alias()
          : count === 2
            ? deployment(productionAppSha)
            : alias("dpl_Other"),
      );
    }),
    /alias moved/u,
  );
});

test("exact schema-only release requires main, full CI, live app, and no waivers", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "csf-schema-only-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fictional fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(resolve(cwd, "package.json"), "{}\n");
  git("add", ".");
  git("commit", "-m", "Fictional deployed app");
  const productionAppSha = git("rev-parse", "HEAD");
  for (const path of reviewedFiles) {
    mkdirSync(dirname(resolve(cwd, path)), { recursive: true });
    writeFileSync(resolve(cwd, path), readReviewedHotfixFile("schema", path));
  }
  git("add", ".");
  git("commit", "-m", "Fictional schema hotfix");
  const releaseSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  const config = {
    cwd,
    releaseSha,
    controllerSha: releaseSha,
    productionAppSha,
    confirmation: `schema-only:${productionAppSha}:${releaseSha}`,
    repository: repo,
    repositoryId: repoId,
    token: "fictional-github-token",
    vercelToken: "fictional-vercel-token",
    projectId,
    teamId,
  };
  let ciConclusion = "success";
  const github = async (url) => {
    if (url.endsWith("/check-runs?per_page=100"))
      return Response.json({
        total_count: 2,
        check_runs: ["full-quality", "db-replay-validation"].map(
          (name, index) => ({
            id: index + 1,
            name,
            status: "completed",
            conclusion: ciConclusion,
            app: { slug: "github-actions" },
            details_url: `https://github.com/${repo}/actions/runs/42/job/${index + 1}`,
          }),
        ),
      });
    if (url.endsWith("/actions/runs/42"))
      return Response.json({
        path: ".github/workflows/ci.yml",
        event: "workflow_dispatch",
        head_sha: releaseSha,
        repository: { full_name: repo },
        head_repository: { full_name: repo },
        status: "completed",
        conclusion: "success",
      });
    throw new Error("Unexpected GitHub request");
  };
  const vercel = async (url) =>
    Response.json(
      String(url).includes("/deployments/")
        ? deployment(productionAppSha)
        : alias(),
    );
  const fetchers = { github, vercel };
  const receipt = await verifySchemaOnlySource(config, fetchers);
  assert.equal(receipt.ciRunId, "42");
  assert.equal(receipt.deploymentId, deploymentId);
  assert.equal(receipt.changedPaths, reviewedFiles.length);
  verifyReviewedContent(cwd);
  for (const path of reviewedFiles) {
    const file = resolve(cwd, path);
    const original = readFileSync(file);
    writeFileSync(
      file,
      Buffer.concat([original, Buffer.from("\n# later edit\n")]),
    );
    assert.throws(() => verifyReviewedContent(cwd), /exact reviewed hotfix/u);
    writeFileSync(file, original);
  }
  ciConclusion = "failure";
  await assert.rejects(
    verifySchemaOnlySource(config, fetchers),
    /not successful/u,
  );
  ciConclusion = "success";
  for (const patch of [
    { controllerSha: productionAppSha },
    { confirmation: "" },
    { waiverConfirmation: "waive" },
    { localConfirmation: "override" },
  ])
    await assert.rejects(
      verifySchemaOnlySource({ ...config, ...patch }, fetchers),
    );
  git("update-ref", "refs/remotes/origin/main", productionAppSha);
  await assert.rejects(verifySchemaOnlySource(config, fetchers));
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  const reviewedDocument = resolve(
    cwd,
    "docs/development/production-points-schema-hotfix.md",
  );
  writeFileSync(
    reviewedDocument,
    `${readFileSync(reviewedDocument, "utf8")}\nLater policy change.\n`,
  );
  git("add", "docs/development/production-points-schema-hotfix.md");
  git("commit", "-m", "Fictional later allowed-file change");
  const laterSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", laterSha);
  await assert.rejects(
    verifySchemaOnlySource(
      {
        ...config,
        releaseSha: laterSha,
        controllerSha: laterSha,
        confirmation: `schema-only:${productionAppSha}:${laterSha}`,
      },
      fetchers,
    ),
    /exact reviewed hotfix/u,
  );
  git("reset", "--hard", releaseSha);
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  writeFileSync(resolve(cwd, "package.json"), '{"version":"2"}\n');
  git("add", ".");
  git("commit", "-m", "Fictional dependency change");
  const changedSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", changedSha);
  await assert.rejects(
    verifySchemaOnlySource(
      {
        ...config,
        releaseSha: changedSha,
        controllerSha: changedSha,
        confirmation: `schema-only:${productionAppSha}:${changedSha}`,
      },
      fetchers,
    ),
    /unreviewed change/u,
  );
});
