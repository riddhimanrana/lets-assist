"use strict";
// Explicit offline suite may write scratch/proof data only in its owned stage.
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  os = require("./linux-platform.cjs");
function validCheckStagePath(root, dir) {
  return (
    typeof root === "string" &&
    typeof dir === "string" &&
    path.isAbsolute(root) &&
    path.isAbsolute(dir) &&
    path.dirname(dir) === path.join(root, ".artifacts/layout-audit-tool") &&
    /^ci[a-f0-9]{14}$/u.test(path.basename(dir))
  );
}
function requireOwnedCheckStage(root, dir) {
  if (!validCheckStagePath(root, dir)) os.deny();
  os.canonical(root);
  os.privateDir(dir);
  os.ownFile(path.join(dir, "linux-adapters.check.mjs"));
  if (
    fs.existsSync(path.join(dir, "linux-adapters.test.mjs")) ||
    fs.existsSync(path.join(dir, "proof-data"))
  )
    os.deny();
  const relative = path.relative(root, path.join(dir, "proof-data")),
    ignored = cp
      .execFileSync("/usr/bin/git", ["check-ignore", "--", relative], {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString()
      .trim();
  if (ignored !== relative) os.deny();
  return true;
}
module.exports = { validCheckStagePath, requireOwnedCheckStage };
