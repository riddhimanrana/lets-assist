import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readJson,
  ReleaseCheckError,
  requireSha,
  safeFailureMessage,
  selectQualityChecks,
} from "./app-release-checks.mjs";

// This path is limited to the reviewed dependency repair. Runtime source,
// migrations, the private gitlink, and deployment settings remain identical
// to the application currently served by the Production alias.
const reviewedPaths = new Set([
  ".github/workflows/deploy-app-only.yml",
  "bun.lock",
  "docs/development/deployment.md",
  "package.json",
  "scripts/plugins/fast-glob-compat.test.ts",
  "scripts/production/security-only-app-source.mjs",
  "scripts/production/security-only-app-source.test.mjs",
  "vendor/fast-glob-compat/index.cjs",
  "vendor/fast-glob-compat/index.d.ts",
  "vendor/fast-glob-compat/package.json",
]);
const requiredPaths = [...reviewedPaths];
// Exact reviewed contents, rather than broad filenames, bind this one-time
// exception to the dependency repair. This verifier is the guard itself; its
// source is still subject to the exact main commit, full CI, and code review.
const reviewedContentSha256 = Object.freeze({
  ".github/workflows/deploy-app-only.yml":
    "e830f9954658b48a1dc752a7e65c1e3b67e05a82d00b424ca5bfa80f12e29589",
  "bun.lock":
    "c9fcf5c38d2cbedb434e47e1fb03f15852064995659395a54261aa12ac7d2b59",
  "docs/development/deployment.md":
    "032d35ac57f6056f6ab26866b020cb081d9f68ad9df7e5d587d6f53f3d850377",
  "package.json":
    "f693d86088b79e34a7f8c3866375e7ac4fb4f41d8460768e385779db791b52c9",
  "scripts/plugins/fast-glob-compat.test.ts":
    "f94c2aa33ce65cb9fa41a0831a3de751e8713768ec9de6a7fd95049b26abd227",
  "scripts/production/security-only-app-source.test.mjs":
    "5e5257b8208bf5a27b1c9682616c12391799239e1cf6305ec51dbc534fb0b9c3",
  "vendor/fast-glob-compat/index.cjs":
    "8624706331be0d538f1deffbb6cfc9b808ae11ef61e98fba97270e5033535867",
  "vendor/fast-glob-compat/index.d.ts":
    "0400b2d1f1789ae622dc2f6379255f34ca253571882c77015b05871b6df559ba",
  "vendor/fast-glob-compat/package.json":
    "80c3768c7991bb36cb3b2f10c191a75505f6273fa4ea042e7b3601fad857a528",
});

export function verifySecurityOnlyPaths(paths) {
  if (
    requiredPaths.some((path) => !paths.includes(path)) ||
    paths.some((path) => !reviewedPaths.has(path))
  ) {
    throw new ReleaseCheckError(
      "Security-only source contains an unreviewed change or lacks the dependency repair.",
    );
  }
  return paths.length;
}

export function verifyReviewedContent(cwd) {
  for (const [path, expected] of Object.entries(reviewedContentSha256)) {
    try {
      const file = resolve(cwd, path);
      if (!lstatSync(file).isFile()) throw new Error("Not a regular file");
      const actual = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      if (actual !== expected) throw new Error("Content differs");
    } catch {
      throw new ReleaseCheckError(
        "Security-only source differs from the exact reviewed repair.",
      );
    }
  }
}

export function verifyDeployedApp(deployment, config) {
  const [owner, name] = config.repository.split("/");
  if (
    deployment?.id !== config.deploymentId ||
    (deployment?.projectId ?? deployment?.project?.id) !== config.projectId ||
    deployment?.target !== "production" ||
    deployment?.readyState !== "READY" ||
    deployment?.meta?.githubCommitSha !== config.productionAppSha ||
    deployment?.meta?.githubCommitRef !== config.productionAppSha ||
    deployment?.meta?.githubOrg !== owner ||
    deployment?.meta?.githubRepo !== name ||
    deployment?.gitSource?.sha !== config.productionAppSha ||
    String(deployment?.gitSource?.repoId) !== config.repositoryId
  ) {
    throw new ReleaseCheckError(
      "Live Production deployment does not prove the reviewed baseline SHA.",
    );
  }
}

export async function verifyLiveBaseline(config, fetcher = fetch) {
  if (
    !config.vercelToken ||
    !/^[\w.-]+\/[\w.-]+$/u.test(config.repository ?? "") ||
    !/^prj_[A-Za-z0-9]+$/u.test(config.projectId ?? "") ||
    !/^team_[A-Za-z0-9]+$/u.test(config.teamId ?? "") ||
    !/^[1-9][0-9]*$/u.test(config.repositoryId ?? "")
  ) {
    throw new ReleaseCheckError(
      "Missing Production baseline verification context.",
    );
  }
  requireSha(config.productionAppSha);
  const headers = { Authorization: `Bearer ${config.vercelToken}` };
  const aliasUrl = new URL("https://api.vercel.com/v4/aliases");
  aliasUrl.searchParams.set("domain", "lets-assist.com");
  aliasUrl.searchParams.set("projectId", config.projectId);
  aliasUrl.searchParams.set("teamId", config.teamId);
  const alias = async () => {
    const payload = await readJson(aliasUrl, { headers }, fetcher);
    const matches = payload?.aliases?.filter(
      (item) =>
        item?.alias === "lets-assist.com" &&
        item?.projectId === config.projectId,
    );
    if (
      !Array.isArray(matches) ||
      matches.length !== 1 ||
      !/^dpl_[A-Za-z0-9]+$/u.test(matches[0].deploymentId ?? "")
    ) {
      throw new ReleaseCheckError("Production alias is missing or ambiguous.");
    }
    return matches[0].deploymentId;
  };
  const deploymentId = await alias();
  const deployment = await readJson(
    `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${config.teamId}`,
    { headers },
    fetcher,
  );
  verifyDeployedApp(deployment, { ...config, deploymentId });
  if ((await alias()) !== deploymentId)
    throw new ReleaseCheckError(
      "Production alias moved during source verification.",
    );
  return deploymentId;
}

export async function verifyExactFullCi(config, fetcher = fetch) {
  const request = (path) =>
    readJson(
      `https://api.github.com/repos/${config.repository}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${config.githubToken}`,
          Accept: "application/vnd.github+json",
        },
      },
      fetcher,
    );
  const checks = await request(
    `commits/${config.releaseSha}/check-runs?per_page=100`,
  );
  if (checks.total_count > 100)
    throw new ReleaseCheckError(
      "Application checks exceed the bounded inventory.",
    );
  const selected = selectQualityChecks(
    checks.check_runs ?? [],
    config.repository,
  );
  const prefix = `https://github.com/${config.repository}/actions/runs/`;
  const selectedRunId = selected[0].details_url
    .slice(prefix.length)
    .match(/^(\d+)\/job\/\d+$/u)?.[1];
  if (!selectedRunId)
    throw new ReleaseCheckError(
      "Required CI check has no trusted workflow run.",
    );
  const run = await request(`actions/runs/${selectedRunId}`);
  if (
    run.path !== ".github/workflows/ci.yml" ||
    !["workflow_dispatch", "workflow_call"].includes(run.event) ||
    run.head_sha !== config.releaseSha ||
    run.repository?.full_name !== config.repository ||
    run.head_repository?.full_name !== config.repository ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  ) {
    throw new ReleaseCheckError(
      "Required CI run does not verify the security release.",
    );
  }
  return selectedRunId;
}

export async function verifySecurityOnlySource(config, fetchers = {}) {
  requireSha(config.releaseSha);
  requireSha(config.productionAppSha);
  requireSha(config.controllerSha);
  if (
    config.releaseSha !== config.controllerSha ||
    config.confirmation !==
      `security-only:${config.productionAppSha}:${config.releaseSha}` ||
    config.waiverConfirmation ||
    config.waiverReason ||
    config.localConfirmation ||
    config.localReason
  ) {
    throw new ReleaseCheckError(
      "Security-only release identity or acceptance mode is invalid.",
    );
  }
  if (
    !/^[\w.-]+\/[\w.-]+$/u.test(config.repository ?? "") ||
    !config.githubToken
  )
    throw new ReleaseCheckError(
      "Missing trusted repository verification context.",
    );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: config.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git("rev-parse", "HEAD") !== config.releaseSha)
    throw new ReleaseCheckError("Checkout SHA differs from release.");
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw new ReleaseCheckError("Application checkout is not clean.");
  git("merge-base", "--is-ancestor", config.releaseSha, "origin/main");
  git(
    "merge-base",
    "--is-ancestor",
    config.productionAppSha,
    config.releaseSha,
  );
  const changedPaths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    config.productionAppSha,
    config.releaseSha,
    "--",
  )
    .split("\0")
    .filter(Boolean);
  verifySecurityOnlyPaths(changedPaths);
  verifyReviewedContent(config.cwd);
  const ciRunId = await verifyExactFullCi(config, fetchers.github);
  const deploymentId = await verifyLiveBaseline(config, fetchers.vercel);
  return {
    releaseSha: config.releaseSha,
    productionAppSha: config.productionAppSha,
    deploymentId,
    ciRunId,
    changedPaths: changedPaths.length,
    acceptance: "security-only-full-ci-and-live-production-baseline",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const config = {
      releaseSha: process.env.RELEASE_SHA,
      productionAppSha: process.env.PRODUCTION_APP_SHA,
      controllerSha: process.env.GITHUB_SHA,
      confirmation: process.env.SECURITY_ONLY_CONFIRMATION,
      waiverConfirmation: process.env.PERFORMANCE_WAIVER_CONFIRMATION,
      waiverReason: process.env.PERFORMANCE_WAIVER_REASON,
      localConfirmation: process.env.LOCAL_VALIDATION_CONFIRMATION,
      localReason: process.env.LOCAL_VALIDATION_REASON,
      repository: process.env.GITHUB_REPOSITORY,
      repositoryId: process.env.GITHUB_REPOSITORY_ID,
      githubToken: process.env.GH_TOKEN,
      vercelToken: process.env.VERCEL_TOKEN,
      projectId: process.env.VERCEL_ROOT_PROJECT_ID,
      teamId: process.env.VERCEL_TEAM_ID,
      cwd: process.cwd(),
    };
    if (process.argv[2] === "live") {
      console.log(
        JSON.stringify({
          productionAppSha: config.productionAppSha,
          deploymentId: await verifyLiveBaseline(config),
        }),
      );
    } else if (process.argv[2] === undefined) {
      console.log(JSON.stringify(await verifySecurityOnlySource(config)));
    } else {
      throw new ReleaseCheckError("Unknown security-only verification mode.");
    }
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
}
