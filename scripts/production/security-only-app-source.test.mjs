import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  verifyDeployedApp,
  verifyExactFullCi,
  verifyLiveBaseline,
  verifySecurityOnlyPaths,
  verifySecurityOnlySource,
} from "./security-only-app-source.mjs";

const repo = "example/application";
const projectId = "prj_Fictional";
const teamId = "team_Fictional";
const repositoryId = "123";
const deploymentId = "dpl_Fictional";
const deployment = (sha) => ({
  id: deploymentId,
  projectId,
  target: "production",
  readyState: "READY",
  meta: {
    githubCommitSha: sha,
    githubCommitRef: sha,
    githubOrg: "example",
    githubRepo: "application",
  },
});
const alias = (id = deploymentId) => ({
  aliases: [{ alias: "lets-assist.com", projectId, deploymentId: id }],
});

test("security-only workflow retains staging, exact public checks and rollback", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy-app-only.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: production/u);
  assert.match(workflow, /production-schema-deployment/u);
  assert.match(
    workflow,
    /security-only:\$\{PRODUCTION_APP_SHA\}:\$\{RELEASE_SHA\}/u,
  );
  assert.match(
    workflow,
    /\[\[ "\$\{RELEASE_SHA\}" == "\$\{GITHUB_SHA\}" \]\]/u,
  );
  assert.match(
    workflow,
    /security-only-app-source\.mjs \| tee \.artifacts\/source-verification\.json/u,
  );
  assert.match(workflow, /security-only-app-source\.mjs live/u);
  assert.match(workflow, /app-release-checks\.mjs schema/u);
  assert.match(workflow, /verify-vercel-project\.sh/u);
  assert.match(workflow, /app-release-stage\.mjs create/u);
  assert.match(workflow, /app-release-stage\.mjs wait/u);
  assert.match(workflow, /app-release-smoke\.mjs/u);
  assert.match(workflow, /Restore prior app if promotion does not settle/u);
  assert.doesNotMatch(
    workflow,
    /db (push|dump|reset)|set-csf-release-worker-control/u,
  );
});

test("reviewed dependency paths exclude app, schema, plugin and unrelated releases", () => {
  const required = [
    "bun.lock",
    "package.json",
    "scripts/plugins/fast-glob-compat.test.ts",
    "vendor/fast-glob-compat/index.cjs",
    "vendor/fast-glob-compat/index.d.ts",
    "vendor/fast-glob-compat/package.json",
  ];
  assert.equal(verifySecurityOnlyPaths(required), 6);
  for (const paths of [
    ["package.json"],
    [...required, "app/page.tsx"],
    [...required, "supabase/migrations/20261013071100_hotfix.sql"],
    [...required, "lib/plugins/private"],
    [...required, "next.config.ts"],
  ])
    assert.throws(() => verifySecurityOnlyPaths(paths));
});

test("baseline deployment is exact, ready and Git-connected", () => {
  const productionAppSha = "a".repeat(40);
  const config = {
    productionAppSha,
    deploymentId,
    projectId,
    repositoryId,
    repository: repo,
  };
  verifyDeployedApp(deployment(productionAppSha), config);
  for (const patch of [
    { id: "dpl_Other" },
    { projectId: "prj_Other" },
    { target: "preview" },
    { readyState: "BUILDING" },
    {
      meta: {
        ...deployment(productionAppSha).meta,
        githubCommitSha: "b".repeat(40),
      },
    },
    { meta: { ...deployment(productionAppSha).meta, githubOrg: "other" } },
    { gitSource: { sha: productionAppSha, repoId: "456" } },
  ])
    assert.throws(() =>
      verifyDeployedApp({ ...deployment(productionAppSha), ...patch }, config),
    );
});

test("live baseline checks alias twice and refuses movement", async () => {
  const productionAppSha = "a".repeat(40);
  const config = {
    productionAppSha,
    projectId,
    teamId,
    repositoryId,
    repository: repo,
    vercelToken: "fictional-token",
  };
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json(calls === 2 ? deployment(productionAppSha) : alias());
  };
  assert.equal(await verifyLiveBaseline(config, fetcher), deploymentId);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    verifyLiveBaseline(config, async () => {
      calls += 1;
      return Response.json(
        calls === 1
          ? alias()
          : calls === 2
            ? deployment(productionAppSha)
            : alias("dpl_Other"),
      );
    }),
    /alias moved/u,
  );
});

test("exact full CI refuses failed, split and unrelated runs", async () => {
  const releaseSha = "b".repeat(40);
  const config = {
    releaseSha,
    repository: repo,
    githubToken: "fictional-token",
  };
  let conclusion = "success";
  let split = false;
  let runSha = releaseSha;
  const fetcher = async (url) => {
    if (url.endsWith("/check-runs?per_page=100"))
      return Response.json({
        total_count: 2,
        check_runs: ["full-quality", "db-replay-validation"].map((name, i) => ({
          id: i + 1,
          name,
          status: "completed",
          conclusion,
          app: { slug: "github-actions" },
          details_url: `https://github.com/${repo}/actions/runs/${split && i ? 43 : 42}/job/${i + 1}`,
        })),
      });
    if (url.endsWith("/actions/runs/42"))
      return Response.json({
        path: ".github/workflows/ci.yml",
        event: "workflow_dispatch",
        head_sha: runSha,
        repository: { full_name: repo },
        head_repository: { full_name: repo },
        status: "completed",
        conclusion: "success",
      });
    throw new Error("Unexpected request");
  };
  assert.equal(await verifyExactFullCi(config, fetcher), "42");
  conclusion = "failure";
  await assert.rejects(verifyExactFullCi(config, fetcher), /not successful/u);
  conclusion = "success";
  split = true;
  await assert.rejects(verifyExactFullCi(config, fetcher), /same run/u);
  split = false;
  runSha = "c".repeat(40);
  await assert.rejects(verifyExactFullCi(config, fetcher), /does not verify/u);
});

test("security-only source requires exact main commit, review diff and no waivers", async (t) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "csf-security-only-source-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fictional fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(resolve(cwd, "package.json"), "{}\n");
  writeFileSync(resolve(cwd, "bun.lock"), "base\n");
  git("add", ".");
  git("commit", "-m", "Fictional Production app");
  const productionAppSha = git("rev-parse", "HEAD");
  mkdirSync(resolve(cwd, "vendor/fast-glob-compat"), { recursive: true });
  mkdirSync(resolve(cwd, "scripts/plugins"), { recursive: true });
  writeFileSync(resolve(cwd, "package.json"), '{"version":"2"}\n');
  writeFileSync(resolve(cwd, "bun.lock"), "repaired\n");
  writeFileSync(
    resolve(cwd, "vendor/fast-glob-compat/index.cjs"),
    "module.exports = {};\n",
  );
  writeFileSync(
    resolve(cwd, "vendor/fast-glob-compat/index.d.ts"),
    "export {};\n",
  );
  writeFileSync(resolve(cwd, "vendor/fast-glob-compat/package.json"), "{}\n");
  writeFileSync(
    resolve(cwd, "scripts/plugins/fast-glob-compat.test.ts"),
    "// fixture\n",
  );
  git("add", ".");
  git("commit", "-m", "Fictional audited dependency repair");
  const releaseSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  const config = {
    cwd,
    releaseSha,
    controllerSha: releaseSha,
    productionAppSha,
    confirmation: `security-only:${productionAppSha}:${releaseSha}`,
    repository: repo,
    repositoryId,
    githubToken: "fictional-github-token",
    vercelToken: "fictional-vercel-token",
    projectId,
    teamId,
  };
  const github = async (url) => {
    if (url.endsWith("/check-runs?per_page=100"))
      return Response.json({
        total_count: 2,
        check_runs: ["full-quality", "db-replay-validation"].map((name, i) => ({
          name,
          id: i + 1,
          status: "completed",
          conclusion: "success",
          app: { slug: "github-actions" },
          details_url: `https://github.com/${repo}/actions/runs/42/job/${i + 1}`,
        })),
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
    throw new Error("Unexpected request");
  };
  const vercel = async (url) =>
    Response.json(
      String(url).includes("/deployments/")
        ? deployment(productionAppSha)
        : alias(),
    );
  const fetchers = { github, vercel };
  const receipt = await verifySecurityOnlySource(config, fetchers);
  assert.equal(receipt.ciRunId, "42");
  assert.equal(receipt.deploymentId, deploymentId);
  for (const patch of [
    { controllerSha: productionAppSha },
    { confirmation: "" },
    { waiverConfirmation: "waive" },
    { localConfirmation: "override" },
  ])
    await assert.rejects(
      verifySecurityOnlySource({ ...config, ...patch }, fetchers),
    );
  git("update-ref", "refs/remotes/origin/main", productionAppSha);
  await assert.rejects(verifySecurityOnlySource(config, fetchers));
  git("update-ref", "refs/remotes/origin/main", releaseSha);
  writeFileSync(resolve(cwd, "app.ts"), "export const changed = true;\n");
  git("add", ".");
  git("commit", "-m", "Fictional app code change");
  const changedSha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", changedSha);
  await assert.rejects(
    verifySecurityOnlySource(
      {
        ...config,
        releaseSha: changedSha,
        controllerSha: changedSha,
        confirmation: `security-only:${productionAppSha}:${changedSha}`,
      },
      fetchers,
    ),
    /unreviewed change/u,
  );
});
