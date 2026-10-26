import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  readJson,
  ReleaseCheckError,
  requireSha,
  safeFailureMessage,
  verifyFullCi,
} from "./app-release-checks.mjs";

export async function verifySchemaReleaseCi(
  { release, accepted, repository, token },
  {
    git = (...args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
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
  )
    throw new ReleaseCheckError(
      "CI evidence source differs from the release tree.",
    );
  const api =
    request ??
    ((path) =>
      readJson(`https://api.github.com/repos/${repository}/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }));
  // The hosted-accepted commit is an ancestor with exactly the same tree.
  // Its full CI run must include successful quality and database replay jobs.
  const run = await verifyFullCi(api, accepted, repository);
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
  })
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch((error) => {
      console.error(safeFailureMessage(error));
      process.exitCode = 1;
    });
}
