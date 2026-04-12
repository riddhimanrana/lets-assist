import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const gitmodulesPath = join(repoRoot, ".gitmodules");
const privateRegistryPath = join(repoRoot, "lib", "plugins", "private", "registry.ts");

const isVercelBuild = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const githubToken = process.env.GITHUB_ACCESS_TOKEN ?? process.env.PRIVATE_SUBMODULE_TOKEN;
const githubUsername =
  process.env.GITHUB_USERNAME ?? process.env.PRIVATE_SUBMODULE_USERNAME ?? "x-access-token";

function log(message) {
  console.log(`[private-submodules] ${message}`);
}

function fail(message) {
  console.error(`[private-submodules] ${message}`);
  process.exit(1);
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
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
  fail("Missing GITHUB_ACCESS_TOKEN (or PRIVATE_SUBMODULE_TOKEN) in the Vercel environment.");
}

const gitmodules = await readFile(gitmodulesPath, "utf8");
const encodedUsername = encodeURIComponent(githubUsername);
const encodedToken = encodeURIComponent(githubToken);

const rewrittenGitmodules = gitmodules.replace(
  /(^\s*url\s*=\s*)https:\/\/github\.com\/([^\s]+)$/gm,
  (_match, prefix, repoPath) => {
    return `${prefix}https://${encodedUsername}:${encodedToken}@github.com/${repoPath}`;
  },
);

if (rewrittenGitmodules !== gitmodules) {
  await writeFile(gitmodulesPath, rewrittenGitmodules);
  log("Rewrote GitHub submodule URL(s) with Vercel credentials.");
} else {
  log("No GitHub submodule URLs needed rewriting.");
}

runGit(["submodule", "sync", "--recursive"]);
runGit(["submodule", "update", "--init", "--recursive"]);

if (!existsSync(privateRegistryPath)) {
  fail(
    `Expected private plugin registry after submodule sync, but it was not found: ${privateRegistryPath}`,
  );
}

log("Private submodules are ready.");