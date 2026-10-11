import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const acceptanceOnlyPaths = new Set([
  ".github/workflows/csf-hosted-development-acceptance.yml",
  "scripts/hosted-development/verify-acceptance-source.mjs",
  "scripts/hosted-development/verify-acceptance-source.test.ts",
  "scripts/hosted-development/test-csf-load.test.ts",
]);

export function assertAcceptanceOnlyChanges(paths) {
  if (paths.some((path) => !acceptanceOnlyPaths.has(path))) {
    throw new Error(
      "Build reuse refused: application or deployment inputs changed.",
    );
  }
}

/** @param {Record<string, string | undefined>} env */
export function verifyAcceptanceSource(env = process.env, gitRun) {
  const accepted = env.ACCEPTED_SHA;
  const deployed = env.DEPLOYED_APP_SHA;
  if (![accepted, deployed].every((sha) => /^[0-9a-f]{40}$/u.test(sha ?? ""))) {
    throw new Error("Acceptance and deployed build SHAs must be explicit.");
  }
  const git =
    gitRun ??
    ((...args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }));
  if (git("rev-parse", "HEAD").trim() !== accepted) {
    throw new Error("Acceptance checkout differs from its authorized SHA.");
  }
  git("merge-base", "--is-ancestor", deployed, accepted);
  const paths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    deployed,
    accepted,
    "--",
  )
    .split("\0")
    .filter(Boolean);
  assertAcceptanceOnlyChanges(paths);
  return {
    acceptedSha: accepted,
    deployedAppSha: deployed,
    changedToolingFiles: paths.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(verifyAcceptanceSource()));
}
