"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const os = require("./linux-platform.cjs");
function shape(b) {
  if (
    typeof b?.template !== "boolean" ||
    typeof b?.materialized !== "boolean" ||
    typeof b?.testOnly !== "boolean" ||
    b?.schema !== "lets-assist-layout-linux-binding-v1" ||
    typeof b.repoRoot !== "string" ||
    !path.isAbsolute(b.repoRoot) ||
    !/^[a-f0-9]{40}$/u.test(b.rootHead ?? "") ||
    b.privateHead !== "38dc7c7aff6fd101c87f92eebfae822d1726f2b4" ||
    b.ledgerCount !== 723 ||
    !os.SHA.test(b.codeManifestSha256 ?? "") ||
    !os.SHA.test(b.dirtyDiffSha256 ?? "") ||
    !Array.isArray(b.capturePaths) ||
    !b.capturePaths.length ||
    !b.reviewedSourceHashes ||
    Object.values(b.reviewedSourceHashes).some((v) => !os.SHA.test(v))
  )
    os.deny();
  if (
    !Number.isInteger(b.uid) ||
    b.uid < 0 ||
    !/^ci[a-f0-9]{14}$/u.test(b.runId ?? "") ||
    b.projectId !== `lets-assist-csf-browser-${b.runId}` ||
    b.workDir !== `/tmp/lets-assist-csf-browser-${b.runId}` ||
    b.appPort !== 3000 ||
    b.privateAppPort !== 3001 ||
    b.apiPort !== 25321 ||
    b.databasePort !== 25322 ||
    typeof b.databaseVolume !== "string" ||
    !b.databaseVolume ||
    !b.node ||
    !b.script ||
    !path.isAbsolute(b.node.path ?? "") ||
    !os.SHA.test(b.node.sha256 ?? "") ||
    b.script.path !==
      path.join(
        b.repoRoot,
        "scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
      ) ||
    !os.SHA.test(b.script.sha256 ?? "") ||
    !os.SHA.test(b.captureTemplateSha256 ?? "") ||
    !path.isAbsolute(b.captureTemplateFile ?? "") ||
    !b.proofHashes ||
    Object.keys(b.proofHashes).sort().join() !==
      [
        "static-image-source-proof.json",
        "next-title-source-proof.json",
        "runtime-cache-source-proof.json",
        "read-action-source-review.json",
        "private-next-title-source-proof.json",
      ]
        .sort()
        .join() ||
    Object.values(b.proofHashes).some((h) => !os.SHA.test(h))
  )
    os.deny();
  return b;
}
function load() {
  const file = process.env.LETS_ASSIST_LAYOUT_BINDING;
  if (!file) os.deny();
  const b = shape(os.readJSON(file));
  return {
    ...b,
    bindingFile: file,
    bindingSha256: os.hash(fs.readFileSync(file)),
  };
}
function live(b) {
  shape(b);
  if (
    process.platform !== "linux" ||
    b.testOnly === true ||
    b.template !== false ||
    b.materialized !== true ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "riddhimanrana/lets-assist" ||
    process.env.GITHUB_SHA !== b.rootHead ||
    process.env.GITHUB_REF === "refs/heads/main" ||
    fs.realpathSync(process.env.GITHUB_WORKSPACE ?? "") !== b.repoRoot ||
    b.uid !== process.getuid()
  )
    os.deny();
  os.ownFile(b.bindingFile);
  if (os.hash(fs.readFileSync(b.bindingFile)) !== b.bindingSha256) os.deny();
  os.codeManifest(__dirname, b.codeManifestSha256);
  for (const [name, h] of Object.entries(b.proofHashes)) {
    const f = path.join(__dirname, "proof-data", name);
    os.ownFile(f);
    if (os.hash(fs.readFileSync(f)) !== h) os.deny();
  }
  os.sourceIdentity(b.repoRoot, b);
  return b;
}
module.exports = { shape, load, live };
