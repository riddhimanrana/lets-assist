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
  verifyFullCi,
} from "./app-release-checks.mjs";

// This emergency path is deliberately narrower than an application promotion.
// A new application, private gitlink, dependency, or migration must use the
// normal hosted Development/cutover path or receive its own reviewed contract.
const reviewedPaths = new Set([
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
  "supabase/migrations/20261013071100_csf_repeatable_pending_activity_claims.sql",
  "supabase/tests/database/csf_fixed_activity_submission_uniqueness.test.sql",
]);
const requiredMigration =
  "supabase/migrations/20261013071100_csf_repeatable_pending_activity_claims.sql";
// The workflow pins this verifier's Git blob before executing it. Its own
// reviewed digest here normalizes only that one literal to avoid a hash cycle.
const reviewedContentSha256 = Object.freeze({
  ".github/workflows/deploy-forward-migrations.yml":
    "e1ad3114a5dfe1ffb485106f11a13a1cc2105285b3bec9cc2b0cb34d1d9642e4",
  "docs/README.md":
    "0ee1a6f1ee14253124d6005a64a7cd44ac1ca41b951bb2ef5a5c9a06b7896e56",
  "docs/development/production-points-schema-hotfix.md":
    "77d89ac21ec2b22934be7bbf894e22fa824c477945033ed2fbea3d1851c3021d",
  "scripts/production/app-release-catalog.mjs":
    "4dd8f5d74f062f36cd354b6c51e7c1de7b5b34aca76666be8b6afc529d361e59",
  "scripts/production/app-release-checks.mjs":
    "64790cb3c0879d0d979ef8bbbac13c4353f293ae6a72e3de90c5bc618acbea65",
  "scripts/production/csf-repeatable-pending-claims-catalog.test.mjs":
    "7d599aee7820689cdfc9f2cc3f0aafedc0dd08619d1640aac25b5a93073e09ef",
  "scripts/production/final-schema-688.json":
    "ca7febe3a632eccb658a2dd58722fc74b9967eb2d72290a2aea4e2bd00eeaf98",
  "scripts/production/final-schema-manifest.md":
    "b264abdf1f4ce88714de4a0bc39c17d9b8a95c4efac33c10bc7ca2ea999183ca",
  "scripts/production/forward-migration-allowlist.mjs":
    "0ee2844e662a296b18e96142a7c3e6fe425cbde4011a65fa7ff37701c78fe328",
  "scripts/production/forward-migration-historical-tails.test.mjs":
    "b57e750066da76c19bbcef59716a4c9779cd3e5221aae35ee2c225c01094d5c4",
  "scripts/production/forward-migration-release-fixture.mjs":
    "8513f54ff5cb9580db80ece00c03efd11ec9aee407ea50418372769e06a887ad",
  "scripts/production/migration-digests.mjs":
    "4b69313e1f28e111f91804cceceb3b2b616cc84e4715e89ffd56c42ea46728b3",
  "scripts/production/production-schema-only-source.test.mjs":
    "b40c9b5e87138c381c5a4c73966ff9902fde94b71109e3eeb9dc7e037a9f1021",
  "supabase/migrations/20261013071100_csf_repeatable_pending_activity_claims.sql":
    "8c3e879a2ac4e50835049ed170f761af8ca6d96463b6eb0dabaf781845274341",
  "supabase/tests/database/csf_fixed_activity_submission_uniqueness.test.sql":
    "9f179fbb7564dbe01f432059e7f09b7882d7e36d78cabd1b758a4738ba32f2f0",
});

export function verifyReviewedPaths(paths) {
  if (
    paths.length !== reviewedPaths.size ||
    !paths.includes(requiredMigration) ||
    paths.some((path) => !reviewedPaths.has(path))
  ) {
    throw new ReleaseCheckError(
      "Schema-only source contains an unreviewed change or lacks the hotfix migration.",
    );
  }
  return paths.length;
}

export function verifyReviewedContent(cwd) {
  try {
    const verifierFile = resolve(
      cwd,
      "scripts/production/production-schema-only-source.mjs",
    );
    if (!lstatSync(verifierFile).isFile()) throw new Error("Not a file");
    const verifier = readFileSync(verifierFile);
    const verifierBlob = createHash("sha1")
      .update(`blob ${verifier.length}\0`)
      .update(verifier)
      .digest("hex");
    for (const [path, expected] of Object.entries(reviewedContentSha256)) {
      const file = resolve(cwd, path);
      if (!lstatSync(file).isFile()) throw new Error("Not a file");
      let contents = readFileSync(file);
      if (path === ".github/workflows/deploy-forward-migrations.yml") {
        const workflow = contents.toString("utf8");
        const anchors = [
          ...workflow.matchAll(
            /^ {10}SCHEMA_ONLY_VERIFIER_BLOB=([0-9a-f]{40})$/gmu,
          ),
        ];
        if (anchors.length !== 1 || anchors[0][1] !== verifierBlob)
          throw new Error("Verifier blob differs");
        contents = Buffer.from(
          workflow.replace(
            anchors[0][0],
            "          SCHEMA_ONLY_VERIFIER_BLOB=<reviewed-verifier-blob>",
          ),
        );
      }
      if (createHash("sha256").update(contents).digest("hex") !== expected)
        throw new Error("Content differs");
    }
  } catch {
    throw new ReleaseCheckError(
      "Schema-only source differs from the exact reviewed hotfix.",
    );
  }
}

export function verifyDeploymentIdentity(deployment, config) {
  if (
    deployment?.id !== config.deploymentId ||
    (deployment?.projectId ?? deployment?.project?.id) !== config.projectId ||
    deployment?.target !== "production" ||
    deployment?.readyState !== "READY" ||
    deployment?.meta?.appOnlyReleaseSha !== config.productionAppSha ||
    !/^[1-9][0-9]*$/u.test(String(deployment?.meta?.appOnlyReleaseRun ?? "")) ||
    deployment?.gitSource?.sha !== config.productionAppSha ||
    String(deployment?.gitSource?.repoId) !== config.repositoryId
  ) {
    throw new ReleaseCheckError(
      "Live Production deployment does not prove the approved application SHA.",
    );
  }
}

export async function verifyLiveProductionApp(config, fetcher = fetch) {
  if (
    !config.vercelToken ||
    !/^[\w.-]+\/[\w.-]+$/u.test(config.repository ?? "") ||
    !/^[A-Za-z0-9_-]+$/u.test(config.projectId ?? "") ||
    !/^[A-Za-z0-9_-]+$/u.test(config.teamId ?? "") ||
    !/^[1-9][0-9]*$/u.test(config.repositoryId ?? "")
  ) {
    throw new ReleaseCheckError(
      "Missing Production deployment verification context.",
    );
  }
  requireSha(config.productionAppSha);
  const headers = { Authorization: `Bearer ${config.vercelToken}` };
  const aliasUrl = new URL("https://api.vercel.com/v4/aliases");
  aliasUrl.searchParams.set("domain", "lets-assist.com");
  aliasUrl.searchParams.set("projectId", config.projectId);
  aliasUrl.searchParams.set("teamId", config.teamId);
  const alias = async () => {
    const result = await readJson(aliasUrl, { headers }, fetcher);
    const matches = result?.aliases?.filter(
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
    `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${config.teamId}&withGitRepoInfo=true`,
    { headers },
    fetcher,
  );
  verifyDeploymentIdentity(deployment, { ...config, deploymentId });
  if ((await alias()) !== deploymentId)
    throw new ReleaseCheckError(
      "Production alias moved during source verification.",
    );
  return deploymentId;
}

export async function verifySchemaOnlySource(config, fetchers = {}) {
  const {
    releaseSha,
    productionAppSha,
    controllerSha,
    repository,
    token,
    cwd,
  } = config;
  requireSha(releaseSha);
  requireSha(productionAppSha);
  requireSha(controllerSha);
  if (
    releaseSha !== controllerSha ||
    config.confirmation !== `schema-only:${productionAppSha}:${releaseSha}` ||
    config.waiverConfirmation ||
    config.waiverReason ||
    config.localConfirmation ||
    config.localReason
  ) {
    throw new ReleaseCheckError(
      "Schema-only release identity or acceptance mode is invalid.",
    );
  }
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? "") || !token)
    throw new ReleaseCheckError(
      "Missing trusted repository verification context.",
    );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git("rev-parse", "HEAD") !== releaseSha)
    throw new ReleaseCheckError("Checkout SHA differs from release.");
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw new ReleaseCheckError("Application checkout is not clean.");
  git("merge-base", "--is-ancestor", releaseSha, "origin/main");
  git("merge-base", "--is-ancestor", productionAppSha, releaseSha);
  const changedPaths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    productionAppSha,
    releaseSha,
    "--",
  )
    .split("\0")
    .filter(Boolean);
  verifyReviewedPaths(changedPaths);
  verifyReviewedContent(cwd);
  const request = (path) =>
    readJson(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
      fetchers.github ?? fetch,
    );
  const ciRunId = await verifyFullCi(request, releaseSha, repository);
  const deploymentId = await verifyLiveProductionApp(config, fetchers.vercel);
  return {
    releaseSha,
    productionAppSha,
    deploymentId,
    ciRunId,
    changedPaths: changedPaths.length,
    acceptance: "schema-only-full-ci-and-live-unchanged-production-app",
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
      confirmation: process.env.SCHEMA_ONLY_CONFIRMATION,
      waiverConfirmation: process.env.PERFORMANCE_WAIVER_CONFIRMATION,
      waiverReason: process.env.PERFORMANCE_WAIVER_REASON,
      localConfirmation: process.env.LOCAL_VALIDATION_CONFIRMATION,
      localReason: process.env.LOCAL_VALIDATION_REASON,
      repository: process.env.GITHUB_REPOSITORY,
      repositoryId: process.env.GITHUB_REPOSITORY_ID,
      token: process.env.GH_TOKEN,
      vercelToken: process.env.VERCEL_TOKEN,
      projectId: process.env.VERCEL_ROOT_PROJECT_ID,
      teamId: process.env.VERCEL_TEAM_ID,
      cwd: process.cwd(),
    };
    if (process.argv[2] === "live") {
      console.log(
        JSON.stringify({
          productionAppSha: config.productionAppSha,
          deploymentId: await verifyLiveProductionApp(config),
        }),
      );
    } else if (process.argv[2] === undefined) {
      console.log(JSON.stringify(await verifySchemaOnlySource(config)));
    } else {
      throw new ReleaseCheckError("Unknown schema-only verification mode.");
    }
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
}
