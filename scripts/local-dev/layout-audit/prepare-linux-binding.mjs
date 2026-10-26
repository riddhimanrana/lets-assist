#!/usr/bin/env node
// Future GitHub-only setup: source facts and proof files, never stack/fixture writes.
import { CSF_SETTINGS_SOURCE_HASHES } from "./csf-settings-reader-contract.mjs";
import { NOTIFICATION_SOURCE_HASHES } from "./notification-reader-contract.mjs";
import fs from "node:fs";
import { verifyCaptureLedger } from "./capture-ledger-policy.mjs";
import { INVITATION_SOURCE_HASHES } from "./invitation-reader-contract.mjs";
import { INTEGRATION_SOURCE_HASHES } from "./integration-reader-contract.mjs";
import { PLUGIN_SOURCE_HASHES } from "./plugin-reader-contract.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url),
  os = require("./linux-platform.cjs");
const dir = fs.realpathSync(new URL(".", import.meta.url).pathname),
  [authorizationFile, output] = process.argv.slice(2);
if (!authorizationFile || !output) os.deny();
const a = os.readJSON(authorizationFile);
if (
  process.platform !== "linux" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "riddhimanrana/lets-assist" ||
  process.env.GITHUB_REF === "refs/heads/main" ||
  a.schema !== "lets-assist-layout-linux-authorization-v1" ||
  a.template !== false ||
  a.reviewed !== true ||
  a.rootHead !== process.env.GITHUB_SHA ||
  a.privateHead !== "8c84d616e4afee34dcd71ede2cb9fdb9af528ac0" ||
  a.repoRoot !== fs.realpathSync(process.env.GITHUB_WORKSPACE ?? "") ||
  !a.reviewedSourceHashes ||
  process.versions.node !== "24.21.0"
)
  os.deny();
os.codeManifest(dir, a.codeManifestSha256);
const source = os.sourceIdentity(a.repoRoot, {
  rootHead: a.rootHead,
  privateHead: a.privateHead,
  dirtyDiffSha256: os.hash(Buffer.from("\n--private--\n")),
});
const git = (args, cwd = a.repoRoot) =>
  execFileSync("/usr/bin/git", args, {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
const baseline = JSON.parse(
  fs.readFileSync(new URL("./baseline-policy.json", import.meta.url)),
);
if (baseline.targetPrivateGitlink !== a.privateHead) os.deny();
execFileSync(
  "/usr/bin/git",
  ["merge-base", "--is-ancestor", baseline.rootHead, a.rootHead],
  { cwd: a.repoRoot, stdio: "ignore" },
);
const ledger = git(["ls-tree", "-r", "HEAD", "--", "supabase/migrations"])
  .split("\n")
  .filter((v) => v.endsWith(".sql"));
verifyCaptureLedger(baseline, ledger);
process.env.CSF_ISOLATED_WORK_DIR = a.workDir;
const dv = await import(
  pathToFileURL(path.join(a.repoRoot, "scripts/local-dev/dv-local-env.mjs"))
);
const marker = dv.inspectCsfIsolatedWorkDir(a.workDir);
dv.getCsfIsolatedSupabaseEnv();
if (
  marker.workDir !== a.workDir ||
  !/^ci[a-f0-9]{14}$/u.test(marker.runId) ||
  marker.projectId !== `lets-assist-csf-browser-${marker.runId}` ||
  marker.apiPort !== 25321 ||
  marker.databasePort !== 25322
)
  os.deny();
const ownSource = (file) => {
  const target = path.join(a.repoRoot, file),
    real = fs.realpathSync(target),
    dependency =
      file.startsWith("node_modules/") ||
      file.startsWith("lib/plugins/private/apps/csf/node_modules/");
  if (
    (!dependency && real !== target) ||
    (dependency &&
      !real.startsWith(
        path.join(
          a.repoRoot,
          file.startsWith("node_modules/")
            ? "node_modules"
            : "lib/plugins/private/apps/csf/node_modules",
        ) + "/",
      ))
  )
    os.deny();
  const st = fs.lstatSync(real);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid())
    os.deny();
  return os.hash(fs.readFileSync(real));
};
const ref = (name) =>
  JSON.parse(fs.readFileSync(new URL("./upstream/" + name, import.meta.url)));
const image = ref("static-image-source-proof.json"),
  title = ref("next-title-source-proof.json"),
  cache = ref("runtime-cache-source-proof.json"),
  review = ref("read-action-source-review.json");
const authorizedHash = (file, original) => {
  const actual = ownSource(file),
    expected = a.reviewedSourceHashes[file] ?? original;
  if (!os.SHA.test(expected ?? "") || actual !== expected) os.deny();
  return actual;
};
const tracked = new Set(git(["ls-files", "--", "public"]).split("\n"));
image.repoRoot = a.repoRoot;
for (const asset of image.assets) {
  if (!tracked.has(asset.sourceFile)) os.deny();
  asset.sha256 = authorizedHash(asset.sourceFile, asset.sha256);
}
for (const f of Object.keys(image.routingSourceHashes))
  image.routingSourceHashes[f] = authorizedHash(
    f,
    image.routingSourceHashes[f],
  );
for (const proof of [title, cache]) {
  proof.repoRoot = a.repoRoot;
  for (const f of proof.files) {
    f.sha256 = authorizedHash(f.repoRelativePath, f.sha256);
    f.realpath = fs.realpathSync(path.join(a.repoRoot, f.repoRelativePath));
  }
}
for (const map of [review.sourceHashes, review.profileReaderSourceHashes])
  for (const f of Object.keys(map)) map[f] = authorizedHash(f, map[f]);
review.notificationReaderSourceHashes = Object.fromEntries(
  Object.entries(NOTIFICATION_SOURCE_HASHES).map(([file, sha]) => [
    file,
    authorizedHash(file, sha),
  ]),
);
review.invitationReaderSourceHashes = Object.fromEntries(
  Object.entries(INVITATION_SOURCE_HASHES).map(([file, sha]) => [
    file,
    authorizedHash(file, sha),
  ]),
);
review.integrationReaderSourceHashes = Object.fromEntries(
  Object.entries(INTEGRATION_SOURCE_HASHES).map(([file, sha]) => [
    file,
    authorizedHash(file, sha),
  ]),
);
review.pluginReaderSourceHashes = Object.fromEntries(
  Object.entries(PLUGIN_SOURCE_HASHES).map(([file, sha]) => [
    file,
    authorizedHash(file, sha),
  ]),
);
review.csfSettingsReaderSourceHashes = Object.fromEntries(
  Object.entries(CSF_SETTINGS_SOURCE_HASHES).map(([file, sha]) => [
    file,
    authorizedHash(file, sha),
  ]),
);
const wasmCache = require("./frozen-wasm-cache.cjs");
const wasmSource = wasmCache.SOURCE_RELATIVE;
cache.files.push({
  repoRelativePath: wasmSource,
  realpath: fs.realpathSync(path.join(a.repoRoot, wasmSource)),
  sha256: authorizedHash(wasmSource, wasmCache.SOURCE_SHA256),
});
cache.immutableEmbeddedWasm = wasmCache.immutableWasmDescriptor();
wasmCache.readPinnedEmbeddedWasm(a.repoRoot);
const privateTitle = structuredClone(title);
privateTitle.repoRoot = path.join(a.repoRoot, "lib/plugins/private/apps/csf");
for (const f of privateTitle.files) {
  const original = title.files.find(
    (r) => r.repoRelativePath === f.repoRelativePath,
  );
  const file = "lib/plugins/private/apps/csf/" + f.repoRelativePath;
  f.sha256 = authorizedHash(file, original.sha256);
  f.realpath = fs.realpathSync(path.join(a.repoRoot, file));
}
const captureFile =
  a.captureTemplateFile ??
  path.join(dir, "upstream/manifest.baseline-template.json");
os.ownFile(captureFile);
const template = JSON.parse(fs.readFileSync(captureFile));
if (
  !os.SHA.test(a.reviewedCaptureTemplateSha256 ?? "") ||
  os.hash(fs.readFileSync(captureFile)) !== a.reviewedCaptureTemplateSha256 ||
  template.schema !== "lets-assist-layout-capture-v2" ||
  !template.captures?.length
)
  os.deny();
const knownIds = new Set(
    ref("manifest.baseline-template.json").captures.map((c) => c.id),
  ),
  ids = new Set();
for (const c of template.captures) {
  if (
    !knownIds.has(c.id) ||
    ids.has(c.id) ||
    typeof c.route !== "string" ||
    !c.route.startsWith("/") ||
    c.route.startsWith("//")
  )
    os.deny();
  ids.add(c.id);
}
const data = path.join(dir, "proof-data");
fs.mkdirSync(data, { mode: 0o700 });
os.privateDir(data, true);
const proofHashes = {};
for (const [n, p] of Object.entries({
  "static-image-source-proof.json": image,
  "next-title-source-proof.json": title,
  "runtime-cache-source-proof.json": cache,
  "read-action-source-review.json": review,
  "private-next-title-source-proof.json": privateTitle,
})) {
  const f = path.join(data, n);
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  proofHashes[n] = os.hash(fs.readFileSync(f));
}
const node = fs.realpathSync(process.execPath),
  script = path.join(
    a.repoRoot,
    "scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
  );
const b = {
  schema: "lets-assist-layout-linux-binding-v1",
  template: false,
  materialized: true,
  testOnly: false,
  repoRoot: a.repoRoot,
  ...source,
  privateHead: a.privateHead,
  ledgerCount: baseline.targetLedgerCount,
  ledgerGitObjectListSha256: baseline.targetLedgerGitObjectListSha256,
  uid: process.getuid(),
  workDir: marker.workDir,
  runId: marker.runId,
  projectId: marker.projectId,
  apiPort: marker.apiPort,
  databasePort: marker.databasePort,
  appPort: 3000,
  privateAppPort: 3001,
  databaseVolume: marker.databaseVolume,
  node: { path: node, sha256: os.hash(fs.readFileSync(node)) },
  script: {
    path: script,
    sha256: ownSource("scripts/local-dev/run-dvhs-csf-isolated-app.mjs"),
  },
  codeManifestSha256: a.codeManifestSha256,
  reviewedSourceHashes: a.reviewedSourceHashes,
  proofHashes,
  captureTemplateFile: captureFile,
  captureTemplateSha256: a.reviewedCaptureTemplateSha256,
  capturePaths: [
    ...new Set(
      template.captures.map(
        (c) => new URL(c.route, "http://127.0.0.1:3000").pathname,
      ),
    ),
  ].sort(),
};
os.privateDir(path.dirname(output));
os.exclusiveJSON(output, b);
process.stdout.write(
  JSON.stringify({
    bindingFile: output,
    bindingSha256: os.hash(fs.readFileSync(output)),
    fixtureRowsObserved: 0,
    pixelsInspected: 0,
  }) + "\n",
);
