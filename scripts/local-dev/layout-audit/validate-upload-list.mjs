#!/usr/bin/env node
// Read only. Prints only exact owned PNG/result paths, never file contents.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BINDING, REPO, requireLiveBinding } from "./linux-binding.mjs";
import { captureSummary } from "./capture-summary.mjs";
const os = createRequire(import.meta.url)("./linux-platform.cjs");
requireLiveBinding();
const manifest = os.readCreatedJSON(process.argv[2]),
  out = manifest.outputDir;
if (
  manifest.schema !== "lets-assist-layout-capture-v2" ||
  manifest.template !== false ||
  manifest.rootHead !== BINDING.rootHead ||
  manifest.privateHead !== BINDING.privateHead ||
  manifest.syntheticOnly !== true ||
  manifest.seedMode !== "csf-isolated-v1" ||
  path.dirname(out) !== path.join(REPO, ".artifacts/layout-audit")
)
  os.deny();
os.privateDir(out);
const finalFile = path.join(out, "capture-results.json"),
  journalFile = path.join(out, "capture-results.jsonl");
os.ownFile(finalFile);
os.ownFile(journalFile);
const final = JSON.parse(fs.readFileSync(finalFile)),
  journal = fs
    .readFileSync(journalFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((v) => JSON.parse(v));
for (const k of [
  "schema",
  "projectId",
  "rootHead",
  "privateHead",
  "dirtyDiffSha256",
  "buildId",
  "buildDistDir",
  "runtimeBindingSha256",
  "fixtureProofSha256",
])
  if (final[k] !== manifest[k]) os.deny();
if (
  final.completeVisualAudit !== false ||
  final.pixelsInspected !== 0 ||
  JSON.stringify(final.results) !== JSON.stringify(journal)
)
  os.deny();
const scenes = new Map(manifest.captures.map((e) => [e.id, e])),
  modes = ["desktop-light", "desktop-dark", "phone-light", "phone-dark"],
  names = new Set(["capture-results.json", "capture-results.jsonl"]),
  pairs = new Set();
for (const row of journal) {
  const entry = scenes.get(row.id),
    key = row.id + ":" + row.mode;
  if (
    !entry ||
    pairs.has(key) ||
    (!modes.includes(row.mode) &&
      !(
        entry.captureReducedMotion === true &&
        row.mode === "desktop-light-reduced"
      )) ||
    row.pixelsInspected !== false ||
    !["captured-awaiting-pixel-review", "blocked-or-failed"].includes(
      row.status,
    )
  )
    os.deny();
  pairs.add(key);
  if (row.image) {
    const expected = `${row.id}-${row.mode}.png`;
    if (
      row.image !== expected ||
      !/^[a-z0-9-]+\.png$/u.test(expected) ||
      row.status === "blocked-or-failed" ||
      names.has(expected)
    )
      os.deny();
    const file = path.join(out, expected);
    os.ownFile(file);
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const signature = Buffer.alloc(8);
      if (
        fs.readSync(fd, signature, 0, 8, 0) !== 8 ||
        signature.toString("hex") !== "89504e470d0a1a0a"
      )
        os.deny();
    } finally {
      fs.closeSync(fd);
    }
    names.add(expected);
  } else if (row.status !== "blocked-or-failed") os.deny();
}
if (
  JSON.stringify([...names].sort()) !==
  JSON.stringify(fs.readdirSync(out).sort())
)
  os.deny();
requireLiveBinding();
process.stderr.write(JSON.stringify(captureSummary(final, scenes)) + "\n");
process.stdout.write(
  [...names]
    .sort()
    .map((n) => path.join(out, n))
    .join("\n") + "\n",
);
