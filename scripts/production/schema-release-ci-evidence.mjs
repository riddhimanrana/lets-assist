import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  readJson,
  ReleaseCheckError,
  requireSha,
  safeFailureMessage,
  verifyFullCi,
} from "./app-release-checks.mjs";

const controllerPaths = new Set([
  "tests/e2e/csf/platform-landing-stability.spec.ts",
  ".github/workflows/deploy-schema.yml",
  "scripts/production/schema-release-ci-evidence.mjs",
  "scripts/production/schema-release-ci-evidence.test.mjs",
  "scripts/production/points-first-rollout.test.mjs",
  "scripts/production/hosted-acceptance-status-transport.test.mjs",
  "scripts/production/vercel-curl.sh",
  "scripts/production/vercel-curl.test.mjs",
  "scripts/csf-production-release-gate-contract.test.ts",
  "scripts/ci/pipeline-mode.test.mjs",
]);

export async function verifySchemaReleaseCi(
  { release, accepted, repository, token, sourceOnly = false },
  {
    git = (...args) => {
      const output = execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return args[0] === "show" ? output : output.trim();
    },
    request,
  } = {},
) {
  requireSha(release);
  requireSha(accepted);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? "") || !token)
    throw new ReleaseCheckError("Missing trusted CI evidence context.");
  if (git("rev-parse", "HEAD") !== release)
    throw new ReleaseCheckError("CI evidence checkout differs from release.");
  git("merge-base", "--is-ancestor", accepted, release);
  if (
    git("rev-parse", `${accepted}^{tree}`) !==
    git("rev-parse", `${release}^{tree}`)
  ) {
    const changed = git("diff", "--name-only", accepted, release, "--")
      .split("\n")
      .filter(Boolean);
    const budgetPath = "scripts/production/points-first-rollout.mjs";
    const permittedChange = (path) => {
      if (controllerPaths.has(path)) return true;
      if (path !== budgetPath) return false;
      const before = git("show", `${accepted}:${path}`);
      const after = git("show", `${release}:${path}`);
      const writeBudget = "now() - startedAt < 8 * 60 * 1000,";
      const queryBudget = '(mode === "plan" ? 2 : 12)';
      return (
        before.split(writeBudget).length === 3 &&
        before.split(queryBudget).length === 2 &&
        after ===
          before
            .replaceAll(writeBudget, "now() - startedAt < 12 * 60 * 1000,")
            .replace(queryBudget, '(mode === "plan" ? 2 : 16)')
      );
    };
    if (!changed.length || changed.some((path) => !permittedChange(path)))
      throw new ReleaseCheckError(
        "CI evidence source differs from the release tree.",
      );
  }
  const api =
    request ??
    ((path) =>
      readJson(`https://api.github.com/repos/${repository}/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }));
  // Only the listed release-controller files may differ. App, database,
  // dependency and private-plugin bytes must match the accepted source.
  const run = sourceOnly ? null : await verifyFullCi(api, accepted, repository);
  return {
    release,
    accepted,
    run,
    tree: git("rev-parse", `${release}^{tree}`),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  verifySchemaReleaseCi({
    release: process.env.GITHUB_SHA,
    accepted: process.env.ACCEPTED_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
    sourceOnly: process.argv.includes("--source-only"),
  })
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch((error) => {
      console.error(safeFailureMessage(error));
      process.exitCode = 1;
    });
}
