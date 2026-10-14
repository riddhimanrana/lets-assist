#!/usr/bin/env node
// Preparation only: produces DISABLED metadata for root review; never invokes an action.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REPO, digest, exactCompiledBuild, fail } from "./capture-contract.mjs";
import { readActionPolicyFromCompiled } from "./capture-effects-contract.mjs";
function owned(file) {
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077
  )
    fail("Owner-only nonsymlink file required");
  return fs.readFileSync(file);
}
const [input, output] = process.argv.slice(2);
if (!input || !output || !path.isAbsolute(output) || fs.existsSync(output))
  fail("Supply canonical manifest and a new absolute owner-only output path");
const m = JSON.parse(owned(input));
if (
  m.schema !== "lets-assist-layout-capture-v2" ||
  m.template !== false ||
  m.repoRoot !== REPO ||
  m.syntheticOnly !== true ||
  m.serverMode !== "production"
)
  fail("Materialized canonical capture manifest required");
const git = (repo, ...args) =>
  execFileSync("/usr/bin/git", args, {
    cwd: repo,
    stdio: ["ignore", "pipe", "ignore"],
  });
if (
  git(REPO, "rev-parse", "HEAD").toString().trim() !== m.rootHead ||
  git(path.join(REPO, "lib/plugins/private"), "rev-parse", "HEAD")
    .toString()
    .trim() !== m.privateHead ||
  digest(
    Buffer.concat([
      git(REPO, "diff", "--binary", "HEAD"),
      Buffer.from("\n--private--\n"),
      git(path.join(REPO, "lib/plugins/private"), "diff", "--binary", "HEAD"),
    ]),
  ) !== m.dirtyDiffSha256
)
  fail("Canonical source identity changed");
const directory = exactCompiledBuild(REPO, m),
  file = path.join(directory, "server/server-reference-manifest.json");
const s = fs.lstatSync(file);
if (
  !s.isFile() ||
  s.isSymbolicLink() ||
  s.uid !== process.getuid() ||
  fs.realpathSync(path.dirname(file)) !== path.dirname(file)
)
  fail("Exact owned compiled action manifest required");
const bytes = fs.readFileSync(file);
const sourceReview = JSON.parse(
  owned(
    new URL("./proof-data/read-action-source-review.json", import.meta.url),
  ),
);
const policy = readActionPolicyFromCompiled(
  JSON.parse(bytes),
  REPO,
  digest(bytes),
  sourceReview.sourceHashes,
);
fs.writeFileSync(output, JSON.stringify(policy, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(
  JSON.stringify({
    policyOutput: output,
    enabled: false,
    reviewed: false,
    actionCount: policy.approvedActions.length,
    actionsInvoked: 0,
  }) + "\n",
);
