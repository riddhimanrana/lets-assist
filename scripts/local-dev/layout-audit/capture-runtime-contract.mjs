// External acceptance binding only; never launches a process or emits process/env data.
import fs from "node:fs";
import { createRequire } from "node:module";
import { BINDING, requireLiveBinding } from "./linux-binding.mjs";
import { validateBuild, validateSpawn } from "./linux-proof-contract.mjs";
const linux = createRequire(import.meta.url)("./linux-platform.cjs");
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  REPO,
  BUILD_ARTIFACTS,
  BUILD_DIST_DIR,
  SHA256,
  digest,
  fail,
} from "./capture-contract.mjs";
import {
  runtimeCachePolicy,
  runtimeCacheEntrySafe,
} from "./capture-cache-contract.mjs";
import {
  SPAWN_OBSERVER,
  exactNextTitleSource,
  spawnBindingGuard,
  readContemporaneousSpawn,
} from "./capture-spawn-contract.mjs";
const run = (binary, args, cwd) => {
  try {
    return execFileSync(binary, args, {
      cwd,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", TZ: "UTC", LANG: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("Runtime observation failed; private output omitted");
  }
};
const ownedFile = (file) => {
  if (
    typeof file !== "string" ||
    !path.isAbsolute(file) ||
    fs.realpathSync(file) !== file
  )
    fail("Canonical binding path required");
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077
  )
    fail("New owner-only binding file required");
  return s;
};
// Treat actual Next dynamic/group/slot syntax as literal components; never decode
// or normalize a declared artifact path. Full relative file-set and bytes stay bound.
const safeRelative = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name
    .split("/")
    .every(
      (component) =>
        component !== "" &&
        component !== "." &&
        component !== ".." &&
        /^[a-zA-Z0-9._@[\]()-]+$/u.test(component),
    );
const isPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;
export function sourceIdentity(repo = REPO) {
  const priv = path.join(repo, "lib/plugins/private");
  const rootHead = run("/usr/bin/git", ["rev-parse", "HEAD"], repo),
    privateHead = run("/usr/bin/git", ["rev-parse", "HEAD"], priv);
  const diff = (r) => {
    try {
      return execFileSync("/usr/bin/git", ["diff", "--binary", "HEAD"], {
        cwd: r,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      fail("Source observation failed");
    }
  };
  const rootDiff = diff(repo),
    privateDiff = diff(priv);
  if (
    rootDiff.length ||
    privateDiff.length ||
    run("/usr/bin/git", ["ls-files", "--others", "--exclude-standard"], repo) ||
    run("/usr/bin/git", ["ls-files", "--others", "--exclude-standard"], priv)
  )
    fail("Canonical runtime requires clean exact source");
  return {
    rootHead,
    privateHead,
    dirtyDiffSha256: digest(
      Buffer.concat([rootDiff, Buffer.from("\n--private--\n"), privateDiff]),
    ),
  };
}
export function newCaptureOutput(repo, output) {
  const parent = path.join(repo, ".artifacts/layout-audit");
  if (
    typeof output !== "string" ||
    path.dirname(output) !== parent ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/u.test(path.basename(output)) ||
    fs.realpathSync(repo) !== repo ||
    fs.realpathSync(output) !== output
  )
    fail("New canonical layout output required");
  for (const directory of [path.join(repo, ".artifacts"), parent, output]) {
    const s = fs.lstatSync(directory);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      (directory === output && s.mode & 0o077)
    )
      fail("Owned nonsymlink output directory required");
  }
  if (fs.readdirSync(output).length)
    fail("Capture output must be NEW and empty");
  if (
    run(
      "/usr/bin/git",
      [
        "check-ignore",
        "--",
        path.relative(repo, output) + "/capture-results.json",
      ],
      repo,
    ) !==
    path.relative(repo, output) + "/capture-results.json"
  )
    fail("Capture output must be Git ignored");
  return output;
}
export function validateCaptureNames(entries) {
  if (!Array.isArray(entries) || !entries.length)
    fail("Explicit capture entries required");
  const names = new Set();
  for (const e of entries) {
    if (
      !e ||
      typeof e.id !== "string" ||
      !/^[a-z0-9-]{1,90}$/u.test(e.id) ||
      names.has(e.id)
    )
      fail("Unique safe capture ID required");
    names.add(e.id);
  }
  return true;
}
export function createExclusiveReceipt(file) {
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  const s = fs.fstatSync(fd);
  if (!s.isFile() || s.uid !== process.getuid()) {
    fs.closeSync(fd);
    fail("Exclusive receipt ownership failed");
  }
  return fd;
}
export function appendDurableReceipt(fd, value) {
  fs.writeSync(fd, JSON.stringify(value) + "\n");
  fs.fsyncSync(fd);
}
export function freezeCompiledFiles(directory, cachePolicy) {
  if (fs.realpathSync(directory) !== directory)
    fail("Canonical full build path required");
  const root = fs.lstatSync(directory);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    root.uid !== process.getuid()
  )
    fail("Owned full build directory required");
  const names = [];
  const visit = (base, relative) => {
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      const file = path.join(base, ent.name),
        rel = relative ? `${relative}/${ent.name}` : ent.name;
      const st = fs.lstatSync(file);
      if (st.isSymbolicLink() || st.uid !== process.getuid())
        fail("Compiled artifact ownership/path/symlink refused");
      const cache = runtimeCacheEntrySafe(directory, rel, st, cachePolicy);
      if (!cache && !safeRelative(rel)) fail("Compiled artifact path refused");
      if (st.isDirectory()) visit(file, rel);
      else if (st.isFile()) {
        if (!cache) names.push(rel);
      } else fail("Unexpected compiled artifact type");
    }
  };
  visit(directory, "");
  if (
    BUILD_ARTIFACTS.some((f) => !names.includes(f)) ||
    !names.some((f) => f.startsWith("server/")) ||
    !names.some((f) => f.startsWith("static/"))
  )
    fail("Complete canonical server/static build required");
  return Object.fromEntries(
    names
      .sort()
      .map((rel) => [rel, digest(fs.readFileSync(path.join(directory, rel)))]),
  );
}
export function exactCompiledFiles(directory, hashes, cachePolicy) {
  const actual = freezeCompiledFiles(directory, cachePolicy);
  if (
    !hashes ||
    typeof hashes !== "object" ||
    Array.isArray(hashes) ||
    Object.entries(hashes).some(
      ([n, h]) => !safeRelative(n) || !SHA256.test(h),
    ) ||
    JSON.stringify(actual) !==
      JSON.stringify(
        Object.fromEntries(
          Object.keys(hashes)
            .sort()
            .map((n) => [n, hashes[n]]),
        ),
      )
  )
    fail("Canonical full compiled worker/static artifact set drifted");
  return actual;
}
export function bindingShapeGuard(receipt, expected) {
  if (
    !receipt ||
    receipt.schema !== "lets-assist-layout-runtime-binding-v1" ||
    receipt.materialized !== true ||
    receipt.fromCanonicalLaunch !== true ||
    receipt.sourceClean !== true ||
    receipt.buildFinalized !== true
  )
    fail("Disabled/unmaterialized canonical launch binding refused");
  if (
    !expected ||
    expected.repoRoot !== REPO ||
    !/^[a-f0-9]{40}$/u.test(expected.rootHead) ||
    !/^[a-f0-9]{40}$/u.test(expected.privateHead) ||
    !SHA256.test(expected.dirtyDiffSha256) ||
    !path.isAbsolute(expected.workDir ?? "") ||
    typeof expected.runId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(expected.runId) ||
    expected.projectId !== `lets-assist-csf-browser-${expected.runId}` ||
    ![expected.appPort, expected.apiPort, expected.databasePort].every(
      isPort,
    ) ||
    new Set([expected.appPort, expected.apiPort, expected.databasePort])
      .size !== 3 ||
    !/^[a-zA-Z0-9_-]+$/u.test(expected.buildId ?? "")
  )
    fail("Invalid expected canonical source/stack tuple");
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
    "buildId",
  ])
    if (receipt[key] !== expected[key])
      fail("Canonical launch/source/stack tuple mismatch");
  if (
    receipt.script?.path !==
      path.join(REPO, "scripts/local-dev/run-dvhs-csf-isolated-app.mjs") ||
    !SHA256.test(receipt.script?.sha256 ?? "") ||
    !path.isAbsolute(receipt.node?.path ?? "") ||
    !SHA256.test(receipt.node?.sha256 ?? "") ||
    receipt.uid !== process.getuid()
  )
    fail("Exact canonical script/Node/owner binding required");
  if (
    receipt.buildDistDir !== BUILD_DIST_DIR ||
    receipt.startMode !== "start" ||
    ![
      receipt.createdAtEpochMs,
      receipt.buildCompletedAtEpochMs,
      receipt.portClaimedAtEpochMs,
      receipt.runner?.startedAtEpochMs,
      receipt.listener?.startedAtEpochMs,
    ].every((n) => Number.isFinite(n) && n > 0) ||
    receipt.portWasVacant !== true ||
    receipt.buildCompletedAtEpochMs >= receipt.createdAtEpochMs ||
    receipt.portClaimedAtEpochMs >= receipt.createdAtEpochMs ||
    receipt.createdAtEpochMs < receipt.listener.startedAtEpochMs ||
    receipt.runner.startedAtEpochMs >= receipt.createdAtEpochMs
  )
    fail(
      "Completed build and fresh port must precede listener and new receipt",
    );
  for (const role of ["runner", "listener"]) {
    const p = receipt[role];
    if (
      !Number.isInteger(p?.pid) ||
      p.pid < 2 ||
      p.uid !== receipt.uid ||
      p.cwd !== REPO ||
      typeof p.startIdentity !== "string" ||
      !p.startIdentity ||
      !Array.isArray(p.argv) ||
      p.argv.some((a) => typeof a !== "string" || !a || /\s/u.test(a)) ||
      p.argv[0] !== receipt.node.path
    )
      fail("Exact process executable/argv/start/cwd receipt required");
  }
  if (
    receipt.cachePolicy?.enabled !== true ||
    !SHA256.test(receipt.cachePolicy?.sourceProofSha256 ?? "") ||
    receipt.cachePolicy?.appPathsManifestSha256 !==
      receipt.compiledFileHashes?.["server/app-paths-manifest.json"] ||
    JSON.stringify(receipt.cachePolicy?.selectedPaths) !==
      JSON.stringify(expected.cacheSelectedPaths)
  )
    fail(
      "Reviewed source/manifest/selected-route cache data boundary required",
    );
  if (
    receipt.listenerTitle !== "next-server (v16.4.0)" ||
    !SHA256.test(receipt.nextTitleSourceProofSha256 ?? "") ||
    receipt.spawnObserver?.path !== SPAWN_OBSERVER ||
    !SHA256.test(receipt.spawnObserver?.sha256 ?? "") ||
    !path.isAbsolute(receipt.spawnReceiptFile ?? "") ||
    !SHA256.test(receipt.spawnReceiptSha256 ?? "") ||
    !path.isAbsolute(receipt.spawnObserverOptInFile ?? "") ||
    !SHA256.test(receipt.spawnObserverOptInSha256 ?? "")
  )
    fail("Actual frozen canonical spawn/title provenance required");
  if (
    receipt.runner.pid === receipt.listener.pid ||
    receipt.runner.argv.length !== 2 ||
    receipt.runner.argv[1] !== receipt.script.path ||
    receipt.listener.argv.slice(1).join("\n") !==
      [
        path.join(REPO, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(receipt.appPort),
      ].join("\n")
  )
    fail("Exact canonical production Next start receipt required");
  const hashes = receipt.compiledFileHashes;
  if (
    !hashes ||
    typeof hashes !== "object" ||
    Array.isArray(hashes) ||
    Object.entries(hashes).some(
      ([n, h]) => !safeRelative(n) || !SHA256.test(h),
    ) ||
    BUILD_ARTIFACTS.some((f) => !Object.hasOwn(hashes, f)) ||
    !Object.keys(hashes).some((n) => n.startsWith("server/")) ||
    !Object.keys(hashes).some((n) => n.startsWith("static/")) ||
    !Array.isArray(receipt.servedArtifacts) ||
    receipt.servedArtifacts.length !== 2
  )
    fail("Canonical complete compiled/served artifact receipt required");
  const manifest = `static/${receipt.buildId}/_buildManifest.js`;
  if (receipt.servedArtifacts[0].relativeBuildFile !== manifest)
    fail("Actual served BUILD_ID manifest proof required");
  for (const asset of receipt.servedArtifacts) {
    if (
      !safeRelative(asset.relativeBuildFile) ||
      !asset.relativeBuildFile.startsWith("static/") ||
      asset.urlPath !== `/_next/${asset.relativeBuildFile}` ||
      !SHA256.test(asset.sha256 ?? "") ||
      hashes[asset.relativeBuildFile] !== asset.sha256
    )
      fail("Exact compiled served chunk identity required");
  }
  if (
    !/^static\/chunks\/.+\.js$/u.test(
      receipt.servedArtifacts[1].relativeBuildFile,
    )
  )
    fail("A distinct compiled static JavaScript chunk is required");
  return true;
}
export function runtimeBindingGuard(
  receipt,
  expected,
  observed,
  spawn,
  titleProof,
) {
  bindingShapeGuard(receipt, expected);
  spawnBindingGuard(spawn, receipt, titleProof);
  for (const role of ["runner", "listener"]) {
    const p = receipt[role],
      o = observed?.[role];
    if (
      !o ||
      o.pid !== p.pid ||
      o.uid !== p.uid ||
      o.cwd !== p.cwd ||
      o.startIdentity !== p.startIdentity ||
      o.startedAtEpochMs !== p.startedAtEpochMs ||
      o.executableMatches !== true ||
      (role === "runner" ? o.argvMatches !== true : o.titleMatches !== true)
    )
      fail(
        "Exact live process executable/argv or source-bound title/start/cwd identity required",
      );
  }
  if (
    observed.listenerDescendsFromRunner !== true ||
    observed.listenerParentPid !== receipt.runner.pid ||
    observed.selectedEnvironmentMatches !== true
  )
    fail("Canonical actual spawn parent/production environment required");
  return true;
}
function observeProcess(proof, nodePath, role, title) {
  const actual = linux.identity(proof.pid);
  linux.sameIdentity(actual, proof);
  const values = linux.processValues(actual, []);
  return {
    ...actual,
    executableMatches: actual.executable === nodePath,
    argvMatches:
      role === "runner" &&
      JSON.stringify(values.argv) === JSON.stringify(proof.argv),
    titleMatches:
      role === "listener" &&
      values.argv.length === 1 &&
      values.argv[0] === title,
  };
}
function selectedEnvironment(pid, expected, runner = false, receipt) {
  const proof = runner ? receipt.runner : receipt.listener;
  const names = [
    "CSF_BROWSER_SERVER_MODE",
    "CSF_ISOLATED_WORK_DIR",
    "CSF_ISOLATED_APP_PORT",
    "NODE_OPTIONS",
    "LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN",
    "LETS_ASSIST_LAYOUT_BINDING",
    "NODE_ENV",
    "NEXT_DIST_DIR",
    "CSF_LOCAL_FIXTURE_MODE",
    "PORT",
    "NEXT_PUBLIC_SUPABASE_URL",
    "DB_URL",
    "SUPABASE_DB_URL",
  ];
  const { env: e } = linux.processValues(proof, names);
  if (runner)
    return (
      e.CSF_BROWSER_SERVER_MODE === "production" &&
      e.CSF_ISOLATED_WORK_DIR === expected.workDir &&
      e.CSF_ISOLATED_APP_PORT === String(expected.appPort) &&
      e.NODE_OPTIONS === `--require ${SPAWN_OBSERVER}` &&
      e.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN ===
        receipt.spawnObserverOptInFile &&
      e.LETS_ASSIST_LAYOUT_BINDING === BINDING.bindingFile
    );
  if (
    e.NODE_ENV !== "production" ||
    e.NEXT_DIST_DIR !== BUILD_DIST_DIR ||
    e.CSF_LOCAL_FIXTURE_MODE !== "1" ||
    e.PORT !== String(expected.appPort) ||
    e.CSF_ISOLATED_WORK_DIR !== expected.workDir ||
    e.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${expected.apiPort}` ||
    e.NODE_OPTIONS !==
      `--require ${path.join(REPO, "scripts/local-dev/cron-egress-guard.cjs")}`
  )
    return false;
  try {
    for (const name of ["DB_URL", "SUPABASE_DB_URL"]) {
      const u = new URL(e[name]);
      if (
        !["postgres:", "postgresql:"].includes(u.protocol) ||
        u.hostname !== "127.0.0.1" ||
        Number(u.port) !== expected.databasePort
      )
        return false;
    }
  } catch {
    return false;
  }
  return true;
}
export async function verifyPrivateRuntime(receipt) {
  const p = receipt.privateRuntime;
  if (
    !p ||
    p.buildDirectory !==
      path.join(REPO, "lib/plugins/private/apps/csf/.next") ||
    !p.compiledFileHashes ||
    !p.buildId ||
    p.port !== 3001 ||
    p.listener?.parentPid !== receipt.runner.pid ||
    p.listener?.cwd !== path.join(REPO, "lib/plugins/private/apps/csf")
  )
    fail("Actual private compiled runtime proof required");
  const proofFile = new URL(
      "./proof-data/private-next-title-source-proof.json",
      import.meta.url,
    ),
    proof = JSON.parse(fs.readFileSync(proofFile));
  if (
    digest(fs.readFileSync(proofFile)) !==
      BINDING.proofHashes["private-next-title-source-proof.json"] ||
    proof.repoRoot !== path.join(REPO, "lib/plugins/private/apps/csf") ||
    proof.exactTitle !== receipt.listenerTitle
  )
    fail("Exact private title source proof required");
  for (const f of proof.files) {
    const target = path.join(proof.repoRoot, f.repoRelativePath),
      real = fs.realpathSync(target),
      s = fs.lstatSync(real);
    if (
      real !== f.realpath ||
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      digest(fs.readFileSync(real)) !== f.sha256
    )
      fail("Private installed Next source drift");
  }
  const actual = linux.identity(p.listener.pid);
  linux.sameIdentity(actual, p.listener);
  const { argv, env: e } = linux.processValues(actual, [
    "NODE_ENV",
    "PORT",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NODE_OPTIONS",
  ]);
  if (
    actual.executable !== receipt.node.path ||
    argv.length !== 1 ||
    argv[0] !== receipt.listenerTitle ||
    e.NODE_ENV !== "production" ||
    e.PORT !== "3001" ||
    e.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${BINDING.apiPort}` ||
    e.NODE_OPTIONS !==
      `--require ${path.join(REPO, "scripts/local-dev/cron-egress-guard.cjs")}`
  )
    fail("Actual private process/environment mismatch");
  linux.assertListener(actual, 3001);
  const actualFiles = linux.freezeFiles(p.buildDirectory);
  if (
    JSON.stringify(actualFiles) !== JSON.stringify(p.compiledFileHashes) ||
    fs.readFileSync(path.join(p.buildDirectory, "BUILD_ID"), "utf8").trim() !==
      p.buildId
  )
    fail("Private compiled artifact drift");
  if (p.servedArtifacts?.length !== 2)
    fail("Private served BUILD_ID/chunk evidence required");
  for (const a of p.servedArtifacts) {
    if (
      !safeRelative(a.relativeBuildFile) ||
      !a.relativeBuildFile.startsWith("static/") ||
      a.urlPath !== `/_next/${a.relativeBuildFile}` ||
      p.compiledFileHashes[a.relativeBuildFile] !== a.sha256
    )
      fail("Private served artifact identity mismatch");
    const response = await fetch(`http://127.0.0.1:3001${a.urlPath}`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (
      response.status !== 200 ||
      digest(Buffer.from(await response.arrayBuffer())) !== a.sha256
    )
      fail("Private served artifact bytes mismatch");
  }
  return true;
}
export function verifyRuntimeEvents(receipt) {
  const directory = path.dirname(receipt.spawnReceiptFile),
    names = [
      "canonical-build-platform.json",
      "canonical-build-private.json",
      "canonical-next-spawn.json",
      "canonical-next-spawn-private.json",
    ];
  if (
    !receipt.eventReceiptHashes ||
    Object.keys(receipt.eventReceiptHashes).sort().join() !==
      names.sort().join()
  )
    fail("Complete actual canonical event hashes required");
  const events = Object.fromEntries(
    names.map((name) => [
      name,
      linux.readCreatedJSON(
        path.join(directory, name),
        receipt.eventReceiptHashes[name],
      ),
    ]),
  );
  const build = events["canonical-build-platform.json"],
    privBuild = events["canonical-build-private.json"],
    spawn = events["canonical-next-spawn.json"],
    privSpawn = events["canonical-next-spawn-private.json"];
  validateBuild(build, BINDING, "platform");
  validateBuild(privBuild, BINDING, "private");
  validateSpawn(spawn, BINDING, build, "platform");
  validateSpawn(privSpawn, BINDING, privBuild, "private");
  for (const e of Object.values(events)) {
    if (
      e.optInFile !== receipt.spawnObserverOptInFile ||
      e.optInSha256 !== receipt.spawnObserverOptInSha256 ||
      e.observer?.path !== SPAWN_OBSERVER ||
      e.observer.sha256 !== receipt.spawnObserver.sha256
    )
      fail("Actual canonical event/observer mismatch");
  }
  linux.sameIdentity(spawn.runner, receipt.runner);
  linux.sameIdentity(spawn.listener, receipt.listener);
  linux.sameIdentity(privSpawn.listener, receipt.privateRuntime?.listener);
  if (
    JSON.stringify(build.compiledFileHashes) !==
      JSON.stringify(receipt.compiledFileHashes) ||
    JSON.stringify(privBuild.compiledFileHashes) !==
      JSON.stringify(receipt.privateRuntime?.compiledFileHashes) ||
    build.buildId !== receipt.buildId ||
    privBuild.buildId !== receipt.privateRuntime?.buildId ||
    build.buildCompletedAtEpochMs !== receipt.buildCompletedAtEpochMs ||
    build.claimObservedAtEpochMs !== receipt.portClaimedAtEpochMs
  )
    fail("Canonical event/artifact bytes or timing mismatch");
  return true;
}
export async function verifyLiveRuntime(receipt, expected, directory) {
  requireLiveBinding();
  bindingShapeGuard(receipt, expected);
  verifyRuntimeEvents(receipt); // Before any process, environment or network observation.
  for (const file of [receipt.script.path, receipt.node.path]) {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || fs.realpathSync(file) !== file)
      fail("Canonical executable/script realpath required");
  }
  if (
    digest(fs.readFileSync(receipt.script.path)) !== receipt.script.sha256 ||
    digest(fs.readFileSync(receipt.node.path)) !== receipt.node.sha256
  )
    fail("Canonical launcher or Node executable drifted");
  const titleProof = exactNextTitleSource(),
    spawn = readContemporaneousSpawn(receipt, titleProof);
  const runner = observeProcess(receipt.runner, receipt.node.path, "runner"),
    listener = observeProcess(
      receipt.listener,
      receipt.node.path,
      "listener",
      titleProof.title,
    );
  linux.assertListener(receipt.listener, receipt.appPort);
  runtimeBindingGuard(
    receipt,
    expected,
    {
      runner,
      listener,
      listenerDescendsFromRunner: listener.parentPid === runner.pid,
      listenerParentPid: listener.parentPid,
      selectedEnvironmentMatches:
        selectedEnvironment(receipt.listener.pid, expected, false, receipt) &&
        selectedEnvironment(receipt.runner.pid, expected, true, receipt),
    },
    spawn,
    titleProof,
  );
  await verifyPrivateRuntime(receipt);
  const cache = runtimeCachePolicy(
    directory,
    receipt.cachePolicy,
    expected.cacheSelectedPaths,
    expected,
    receipt.compiledFileHashes,
  );
  exactCompiledFiles(directory, receipt.compiledFileHashes, cache);
  for (const asset of receipt.servedArtifacts) {
    const response = await fetch(
      `http://127.0.0.1:${receipt.appPort}${asset.urlPath}`,
      { redirect: "error", signal: AbortSignal.timeout(10000) },
    );
    if (
      response.status !== 200 ||
      digest(Buffer.from(await response.arrayBuffer())) !== asset.sha256
    )
      fail("Actual served build manifest/chunk identity mismatch");
  }
  return true;
}
export function readRuntimeBinding(file, sha) {
  const _stat = ownedFile(file),
    bytes = fs.readFileSync(file);
  if (!SHA256.test(sha ?? "") || digest(bytes) !== sha)
    fail("Exact immutable runtime receipt hash required");
  const receipt = JSON.parse(bytes);
  linux.readCreatedJSON(file, sha);
  if (
    receipt.materialized !== true ||
    !Number.isFinite(receipt.createdAtEpochMs) ||
    !Number.isFinite(receipt.buildCompletedAtEpochMs) ||
    receipt.createdAtEpochMs <= receipt.buildCompletedAtEpochMs ||
    receipt.bindingFile !== BINDING.bindingFile ||
    receipt.bindingSha256 !== BINDING.bindingSha256 ||
    receipt.codeManifestSha256 !== BINDING.codeManifestSha256
  )
    fail("Actual exclusive inode/runtime binding required");
  return receipt;
}
