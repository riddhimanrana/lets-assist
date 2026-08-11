import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const gitmodulesPath = join(repoRoot, ".gitmodules");
const privateRegistryPath = join(
  repoRoot,
  "lib",
  "plugins",
  "private",
  "registry.ts",
);

const isVercelBuild =
  process.env.VERCEL === "1" || process.env.VERCEL === "true";
const githubToken =
  process.env.GITHUB_ACCESS_TOKEN ?? process.env.PRIVATE_SUBMODULE_TOKEN;
const githubUsername =
  process.env.GITHUB_USERNAME ??
  process.env.PRIVATE_SUBMODULE_USERNAME ??
  "x-access-token";

function log(message) {
  console.log(`[private-submodules] ${message}`);
}

function fail(message) {
  console.error(`[private-submodules] ${message}`);
  process.exit(1);
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.status !== 0) {
    fail(
      `git ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
}

if (!isVercelBuild) {
  log("Skipping private submodule sync outside Vercel.");
  process.exit(0);
}

if (!existsSync(gitmodulesPath)) {
  log("No .gitmodules file found; skipping private submodule sync.");
  process.exit(0);
}

if (!githubToken) {
  fail(
    "Missing GITHUB_ACCESS_TOKEN (or PRIVATE_SUBMODULE_TOKEN) in the Vercel environment.",
  );
}

runGit(["submodule", "sync", "--recursive"]);

// Pass credentials only to this Git process. Keeping them out of .gitmodules,
// command arguments, and persisted Git config avoids leaking the token in
// diffs, strict-check errors, or later build output.
const basicCredential = Buffer.from(
  `${githubUsername}:${githubToken}`,
  "utf8",
).toString("base64");
runGit(["submodule", "update", "--init", "--recursive"], {
  env: {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicCredential}`,
  },
});

if (!existsSync(privateRegistryPath)) {
  fail(
    `Expected private plugin registry after submodule sync, but it was not found: ${privateRegistryPath}`,
  );
}

log("Private submodules are ready.");
