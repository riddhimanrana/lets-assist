// Read-only verification of root's contemporaneous canonical spawn observation.
import fs from "node:fs";
import { createRequire } from "node:module";
import { BINDING } from "./linux-binding.mjs";
const linux = createRequire(import.meta.url)("./linux-platform.cjs");
import path from "node:path";
import { REPO, SHA256, digest, fail } from "./capture-contract.mjs";
export const SPAWN_OBSERVER = fs.realpathSync(
  new URL("./capture-spawn-observer.cjs", import.meta.url),
);
const TITLE_PROOF = new URL(
  "./proof-data/next-title-source-proof.json",
  import.meta.url,
);
const owned = (file) => {
  if (
    typeof file !== "string" ||
    !path.isAbsolute(file) ||
    fs.realpathSync(file) !== file
  )
    fail("Canonical spawn evidence path required");
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077
  )
    fail("Owner-only immutable spawn evidence required");
  return s;
};
export function exactNextTitleSource() {
  const file = TITLE_PROOF.pathname;
  owned(file);
  const bytes = fs.readFileSync(file),
    proof = JSON.parse(bytes);
  const paths = [
    "node_modules/next/package.json",
    "node_modules/next/dist/bin/next",
    "node_modules/next/dist/cli/next-start.js",
    "node_modules/next/dist/server/lib/start-server.js",
  ];
  if (
    proof.schema !== "lets-assist-next-title-source-proof-v1" ||
    proof.sourceOnly !== true ||
    proof.repoRoot !== REPO ||
    proof.version !== "16.4.0" ||
    proof.exactTitle !== "next-server (v16.4.0)" ||
    proof.assignment !== 'process.title = `next-server (v${"16.4.0"})`;' ||
    !Array.isArray(proof.files) ||
    proof.files.map((f) => f.repoRelativePath).join("\n") !== paths.join("\n")
  )
    fail("Exact source-bound Next title proof required");
  for (const entry of proof.files) {
    const target = path.join(REPO, entry.repoRelativePath),
      real = fs.realpathSync(target),
      st = fs.lstatSync(real);
    if (
      real !== entry.realpath ||
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.uid !== process.getuid() ||
      !SHA256.test(entry.sha256) ||
      digest(fs.readFileSync(real)) !== entry.sha256
    )
      fail("Installed Next title/CLI source drifted");
  }
  if (
    JSON.parse(fs.readFileSync(path.join(REPO, paths[0]))).version !==
      proof.version ||
    !fs
      .readFileSync(path.join(REPO, paths[3]), "utf8")
      .includes(proof.assignment)
  )
    fail("Actual Next version/title assignment mismatch");
  return {
    title: proof.exactTitle,
    version: proof.version,
    sourceProofSha256: digest(bytes),
  };
}
export function spawnBindingGuard(spawn, runtime, titleProof) {
  if (
    !spawn ||
    spawn.schema !== "lets-assist-canonical-next-spawn-v1" ||
    spawn.materialized !== true ||
    spawn.observedSuccessfulSpawn !== true ||
    spawn.selectedChildEnvironmentMatches !== true
  )
    fail("Actual successful contemporaneous canonical spawn required");
  for (const key of [
    "repoRoot",
    "rootHead",
    "privateHead",
    "dirtyDiffSha256",
    "workDir",
    "runId",
    "projectId",
    "appPort",
    "apiPort",
    "databasePort",
    "uid",
  ])
    if (spawn[key] !== runtime[key])
      fail("Spawn/source/owner/stack tuple mismatch");
  for (const key of ["script", "node"])
    if (JSON.stringify(spawn[key]) !== JSON.stringify(runtime[key]))
      fail("Spawn canonical launcher/Node identity mismatch");
  if (
    spawn.observer?.path !== SPAWN_OBSERVER ||
    !SHA256.test(spawn.observer?.sha256 ?? "") ||
    runtime.spawnObserver?.path !== spawn.observer.path ||
    runtime.spawnObserver?.sha256 !== spawn.observer.sha256 ||
    !SHA256.test(spawn.optInSha256 ?? "") ||
    spawn.optInFile !== runtime.spawnObserverOptInFile ||
    spawn.optInSha256 !== runtime.spawnObserverOptInSha256 ||
    spawn.nextTitleSourceProofSha256 !== titleProof.sourceProofSha256 ||
    runtime.nextTitleSourceProofSha256 !== titleProof.sourceProofSha256 ||
    runtime.listenerTitle !== titleProof.title
  )
    fail("Exact frozen observer/opt-in/source-bound title required");
  for (const role of ["runner", "listener"])
    for (const key of [
      "pid",
      "uid",
      "cwd",
      "startIdentity",
      "startedAtEpochMs",
    ])
      if (spawn[role]?.[key] !== runtime[role]?.[key])
        fail("Spawn child/parent PID/start correlation mismatch");
  if (
    JSON.stringify(spawn.runner.argv) !== JSON.stringify(runtime.runner.argv) ||
    JSON.stringify(spawn.listener.argv) !==
      JSON.stringify(runtime.listener.argv) ||
    JSON.stringify(spawn.spawnOptions) !==
      JSON.stringify({
        cwd: REPO,
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      })
  )
    fail("Actual reviewed canonical spawn argv/options required");
  const {
    spawnCallEpochMs: call,
    spawnObservedEpochMs: observed,
    createdAtEpochMs: created,
  } = spawn;
  if (
    ![call, observed, created].every((n) => Number.isFinite(n) && n > 0) ||
    call > observed ||
    observed - call > 10000 ||
    created < observed ||
    created - observed > 10000 ||
    runtime.buildCompletedAtEpochMs >= call ||
    runtime.portClaimedAtEpochMs >= call ||
    runtime.runner.startedAtEpochMs >= call ||
    spawn.listener.startedAtEpochMs < call - 1000 ||
    spawn.listener.startedAtEpochMs > observed ||
    runtime.createdAtEpochMs < created
  )
    fail("Actual spawn ordering/fresh process correlation required");
  return true;
}
export function readContemporaneousSpawn(runtime, titleProof) {
  const file = runtime.spawnReceiptFile,
    _stat = owned(file),
    bytes = fs.readFileSync(file);
  if (
    !SHA256.test(runtime.spawnReceiptSha256 ?? "") ||
    digest(bytes) !== runtime.spawnReceiptSha256
  )
    fail("Immutable contemporaneous spawn receipt hash required");
  const parent = path.join(REPO, ".artifacts/layout-audit-spawn"),
    directory = path.dirname(file);
  if (
    path.dirname(directory) !== parent ||
    path.basename(file) !== "canonical-next-spawn.json" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/u.test(path.basename(directory))
  )
    fail("Exact owned spawn output namespace required");
  for (const p of [path.join(REPO, ".artifacts"), parent, directory]) {
    const s = fs.lstatSync(p);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      (p === directory && s.mode & 0o077) ||
      fs.realpathSync(p) !== p
    )
      fail("Owned canonical spawn output required");
  }
  if (
    fs.readdirSync(directory).sort().join("\n") !==
    [
      "canonical-build-platform.json",
      "canonical-build-private.json",
      "canonical-next-spawn-private.json",
      "canonical-next-spawn.json",
    ]
      .sort()
      .join("\n")
  )
    fail("Unexpected or incomplete canonical build/spawn output refused");
  const spawn = JSON.parse(bytes);
  spawnBindingGuard(spawn, runtime, titleProof);
  linux.readCreatedJSON(file, runtime.spawnReceiptSha256);
  if (
    spawn.bindingFile !== BINDING.bindingFile ||
    spawn.bindingSha256 !== BINDING.bindingSha256 ||
    spawn.codeManifestSha256 !== BINDING.codeManifestSha256 ||
    spawn.createdAtEpochMs < spawn.spawnObservedEpochMs
  )
    fail("Actual inode-bound observer/binding provenance required");
  owned(spawn.optInFile);
  const optBytes = fs.readFileSync(spawn.optInFile);
  if (
    digest(optBytes) !== spawn.optInSha256 ||
    digest(fs.readFileSync(SPAWN_OBSERVER)) !== spawn.observer.sha256
  )
    fail("Frozen observer/explicit opt-in drifted");
  const opt = JSON.parse(optBytes);
  if (
    opt.schema !== "lets-assist-canonical-spawn-observer-opt-in-v1" ||
    opt.template !== false ||
    opt.enabled !== true ||
    opt.allowRuntimeObservation !== true ||
    opt.outputDir !== directory ||
    opt.nextTitleSourceProofSha256 !== titleProof.sourceProofSha256
  )
    fail("Actual explicit root observer opt-in required");
  for (const key of [
    "repoRoot",
    "rootHead",
    "privateHead",
    "dirtyDiffSha256",
    "workDir",
    "runId",
    "projectId",
    "appPort",
    "apiPort",
    "databasePort",
    "uid",
  ])
    if (opt[key] !== runtime[key]) fail("Observer opt-in tuple drifted");
  for (const key of ["node", "script"])
    if (JSON.stringify(opt[key]) !== JSON.stringify(runtime[key]))
      fail("Observer opt-in executable/source drifted");
  if (
    opt.observer?.path !== SPAWN_OBSERVER ||
    opt.observer.sha256 !== spawn.observer.sha256
  )
    fail("Observer preload provenance drifted");
  return spawn;
}
