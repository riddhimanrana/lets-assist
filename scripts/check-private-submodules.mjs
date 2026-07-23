#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const strict = process.argv.includes("--strict") || process.env.PRIVATE_SUBMODULE_STRICT === "1";
const allowDetachedGitlink = process.env.PRIVATE_SUBMODULE_ALLOW_DETACHED_GITLINK === "1";
const expectedPath = "lib/plugins/private";
const expectedBranch = process.env.PRIVATE_PLUGINS_BRANCH ?? "development";
const expectedUrl = "https://github.com/riddhimanrana/lets-assist-plugins.git";
const submodulePath = join(repoRoot, expectedPath);
const registryPath = join(submodulePath, "registry.ts");

let hasFailure = false;

function log(message) {
  console.log(`[private-submodules] ${message}`);
}

function warn(message) {
  console.warn(`[private-submodules] WARN: ${message}`);
}

function fail(message) {
  hasFailure = true;
  console.error(`[private-submodules] FAIL: ${message}`);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status,
  };
}

function requireGit(args, options = {}) {
  const result = git(args, options);
  if (!result.ok) {
    fail(`git ${args.join(" ")} failed: ${result.stderr || result.status}`);
  }
  return result;
}

if (!existsSync(join(repoRoot, ".gitmodules"))) {
  fail("Missing .gitmodules. Private plugin submodule metadata is required.");
} else {
  const pathResult = requireGit(["config", "--file", ".gitmodules", "--get", "submodule.lib/plugins/private.path"]);
  const urlResult = requireGit(["config", "--file", ".gitmodules", "--get", "submodule.lib/plugins/private.url"]);

  if (pathResult.stdout !== expectedPath) {
    fail(`Expected submodule path ${expectedPath}, found ${pathResult.stdout || "<empty>"}.`);
  }

  if (urlResult.stdout !== expectedUrl) {
    fail(`Expected private plugin remote ${expectedUrl}, found ${urlResult.stdout || "<empty>"}.`);
  }
}

if (!existsSync(submodulePath)) {
  fail(`Missing private plugin submodule directory: ${expectedPath}`);
} else if (!existsSync(join(submodulePath, ".git")) && !existsSync(join(submodulePath, ".git", "HEAD"))) {
  fail(`Private plugin submodule is not initialized at ${expectedPath}. Run git submodule update --init --recursive.`);
}

if (!existsSync(registryPath)) {
  fail(`Missing private plugin registry: ${registryPath}`);
}

const status = requireGit(["submodule", "status", "--recursive"]);
const privateStatusLine = status.stdout
  .split("\n")
  .find((line) => line.includes(` ${expectedPath} `) || line.endsWith(` ${expectedPath}`));

if (!privateStatusLine) {
  fail(`git submodule status did not include ${expectedPath}.`);
} else {
  const prefix = privateStatusLine[0];
  if (prefix === "-") {
    fail(`${expectedPath} is not initialized.`);
  } else if (prefix === "+") {
    warn(`${expectedPath} checkout differs from the committed gitlink.`);
  } else if (prefix === "U") {
    fail(`${expectedPath} has unresolved submodule merge conflicts.`);
  }
}

if (existsSync(submodulePath)) {
  const headResult = requireGit(["rev-parse", "HEAD"], { cwd: submodulePath });
  const indexResult = requireGit(["ls-files", "-s", expectedPath]);
  const indexCommit = indexResult.stdout.split(/\s+/)[1] ?? "";

  if (strict && headResult.stdout && indexCommit && indexCommit !== headResult.stdout) {
    fail(
      `${expectedPath} index gitlink ${indexCommit} does not match checked-out submodule HEAD ${headResult.stdout}. Stage the submodule gitlink with \`git add ${expectedPath}\` before publishing.`,
    );
  }

  const remoteResult = requireGit(["remote", "get-url", "origin"], { cwd: submodulePath });
  if (remoteResult.stdout !== expectedUrl) {
    fail(`Expected ${expectedPath} origin ${expectedUrl}, found ${remoteResult.stdout || "<empty>"}.`);
  }

  const branchResult = requireGit(["branch", "--show-current"], { cwd: submodulePath });
  const isDetached = branchResult.ok && !branchResult.stdout;
  if (branchResult.stdout !== expectedBranch && !(allowDetachedGitlink && isDetached)) {
    const message = `Expected ${expectedPath} branch ${expectedBranch}, found ${branchResult.stdout || "detached HEAD"}.`;
    if (strict) fail(message);
    else warn(message);
  } else if (allowDetachedGitlink && isDetached) {
    log(`${expectedPath} is detached at the exact committed gitlink, as expected in CI.`);
  }

  const porcelain = requireGit(["status", "--porcelain"], { cwd: submodulePath });
  if (porcelain.stdout) {
    const message = `${expectedPath} has uncommitted changes:\n${porcelain.stdout}`;
    if (strict) fail(message);
    else warn(message);
  }

  if (!(allowDetachedGitlink && isDetached)) {
    const aheadBehind = git(["rev-list", "--left-right", "--count", `origin/${expectedBranch}...HEAD`], {
      cwd: submodulePath,
    });
    if (aheadBehind.ok) {
      const [behind = "0", ahead = "0"] = aheadBehind.stdout.split(/\s+/);
      if (ahead !== "0" || behind !== "0") {
        const message = `${expectedPath} is ${ahead} commit(s) ahead and ${behind} commit(s) behind origin/${expectedBranch}.`;
        if (strict) fail(message);
        else warn(message);
      }
    } else {
      warn(`Could not compare ${expectedPath} against origin/${expectedBranch}: ${aheadBehind.stderr || aheadBehind.status}`);
    }
  }
}

if (hasFailure) {
  process.exit(1);
}

log(
  strict
    ? "Private plugin submodule strict check passed."
    : "Private plugin submodule check passed with non-blocking drift warnings allowed.",
);
