"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  mod = require("node:module");
const os = require("./linux-platform.cjs"),
  binding = require("./linux-binding.cjs");
const SELF = path.join(__dirname, "capture-spawn-observer.cjs");
function repo() {
  return binding.load().repoRoot;
}
// Schema and opt-in flags are authoritative AFTER the binding spread.
function makeObserverOptIn(b, observer, outputDir) {
  const value = {
    ...b,
    schema: "lets-assist-canonical-spawn-observer-opt-in-v1",
    template: false,
    enabled: true,
    allowRuntimeObservation: true,
    observer,
    outputDir,
    nextTitleSourceProofSha256: b.proofHashes["next-title-source-proof.json"],
  };
  delete value.creationProof;
  return value;
}
function freshOutput(root, out) {
  const parent = path.join(root, ".artifacts/layout-audit-spawn");
  if (
    path.dirname(out) !== parent ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/u.test(path.basename(out))
  )
    os.deny();
  for (const p of [path.join(root, ".artifacts"), parent]) {
    os.canonical(p);
    const s = fs.lstatSync(p);
    if (!s.isDirectory() || s.uid !== process.getuid() || s.isSymbolicLink())
      os.deny();
  }
  os.privateDir(out, true);
  const result = cp
    .execFileSync(
      "/usr/bin/git",
      [
        "check-ignore",
        "--",
        path.relative(root, out) + "/canonical-next-spawn.json",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
    )
    .toString()
    .trim();
  if (result !== path.relative(root, out) + "/canonical-next-spawn.json")
    os.deny();
  return out;
}
function exactSpawnCall(
  command,
  args,
  options,
  opt,
  role = "platform",
  phase = "start",
) {
  const root = repo(),
    cwd =
      role === "private"
        ? path.join(root, "lib/plugins/private/apps/csf")
        : root,
    port = role === "private" ? 3001 : opt.appPort,
    next = path.join(cwd, "node_modules/next/dist/bin/next"),
    expected =
      phase === "build"
        ? [next, "build", "--webpack"]
        : [next, "start", "--hostname", "127.0.0.1", "--port", String(port)];
  if (
    command !== opt.node.path ||
    !Array.isArray(args) ||
    JSON.stringify(args) !== JSON.stringify(expected) ||
    options?.cwd !== cwd ||
    JSON.stringify(options.stdio) !==
      JSON.stringify(["ignore", "inherit", "inherit"]) ||
    options.detached !== true
  )
    return false;
  const e = options.env;
  if (
    !e ||
    e.NODE_ENV !== "production" ||
    e.PORT !== String(port) ||
    e.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${opt.apiPort}` ||
    e.NODE_OPTIONS !==
      `--require ${path.join(root, "scripts/local-dev/cron-egress-guard.cjs")}`
  )
    return false;
  if (role === "platform") {
    if (
      e.NEXT_DIST_DIR !== ".next-csf-isolated/browser-app" ||
      e.CSF_LOCAL_FIXTURE_MODE !== "1" ||
      e.CSF_ISOLATED_WORK_DIR !== opt.workDir
    )
      return false;
    try {
      for (const n of ["DB_URL", "SUPABASE_DB_URL"]) {
        const u = new URL(e[n]);
        if (
          !["postgres:", "postgresql:"].includes(u.protocol) ||
          u.hostname !== "127.0.0.1" ||
          Number(u.port) !== opt.databasePort
        )
          return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
function verifyProofs(b) {
  for (const [name, h] of Object.entries(b.proofHashes)) {
    const f = path.join(__dirname, "proof-data", name);
    os.ownFile(f);
    if (os.hash(fs.readFileSync(f)) !== h) os.deny();
  }
}
function claim(root, pid) {
  const f = `/tmp/lets-assist-csf-isolated-claims-${process.getuid()}/app-port-3000/owner`;
  os.ownFile(f);
  const s = fs.statSync(f),
    v = fs.readFileSync(f, "utf8");
  if (!new RegExp("^pid=" + pid + "\\ntoken=[a-f0-9]{32}\\n$", "u").test(v))
    os.deny();
  return { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode & 0o777, pid };
}
function install(optFile) {
  const b = binding.live(binding.load()),
    opt = os.readCreatedJSON(optFile),
    bytes = fs.readFileSync(optFile),
    root = b.repoRoot,
    script = path.join(root, "scripts/local-dev/run-dvhs-csf-isolated-app.mjs");
  if (
    opt.schema !== "lets-assist-canonical-spawn-observer-opt-in-v1" ||
    opt.template !== false ||
    opt.enabled !== true ||
    opt.allowRuntimeObservation !== true ||
    opt.bindingFile !== b.bindingFile ||
    opt.bindingSha256 !== b.bindingSha256 ||
    opt.codeManifestSha256 !== b.codeManifestSha256 ||
    opt.observer?.path !== SELF ||
    opt.observer.sha256 !== os.hash(fs.readFileSync(SELF)) ||
    process.cwd() !== root ||
    JSON.stringify(process.argv) !== JSON.stringify([b.node.path, script]) ||
    process.env.NODE_OPTIONS !== `--require ${SELF}` ||
    process.env.CSF_BROWSER_SERVER_MODE !== "production" ||
    process.env.CSF_ISOLATED_WORK_DIR !== b.workDir ||
    process.env.CSF_ISOLATED_APP_PORT !== "3000"
  )
    os.deny();
  for (const k of [
    "repoRoot",
    "rootHead",
    "privateHead",
    "dirtyDiffSha256",
    "uid",
    "workDir",
    "runId",
    "projectId",
    "apiPort",
    "databasePort",
    "appPort",
  ])
    if (opt[k] !== b[k]) os.deny();
  for (const k of ["node", "script"])
    if (JSON.stringify(opt[k]) !== JSON.stringify(b[k])) os.deny();
  if (
    os.hash(fs.readFileSync(script)) !== b.script.sha256 ||
    os.hash(fs.readFileSync(b.node.path)) !== b.node.sha256
  )
    os.deny();
  verifyProofs(b);
  freshOutput(root, opt.outputDir);
  const runner = { ...os.identity(process.pid), argv: [...process.argv] },
    original = cp.spawn,
    builds = new Map(),
    seen = new Set();
  let failed = false;
  const common = () => ({
    repoRoot: root,
    rootHead: b.rootHead,
    privateHead: b.privateHead,
    dirtyDiffSha256: b.dirtyDiffSha256,
    uid: b.uid,
    workDir: b.workDir,
    runId: b.runId,
    projectId: b.projectId,
    appPort: b.appPort,
    apiPort: b.apiPort,
    databasePort: b.databasePort,
    script: b.script,
    node: b.node,
    observer: opt.observer,
    optInFile: optFile,
    optInSha256: os.hash(bytes),
    bindingFile: b.bindingFile,
    bindingSha256: b.bindingSha256,
    codeManifestSha256: b.codeManifestSha256,
    runner,
  });
  function failure() {
    failed = true;
    try {
      os.exclusiveJSON(path.join(opt.outputDir, "observer-failure.json"), {
        schema: "lets-assist-linux-observer-failure-v1",
        proved: false,
        reason:
          "Actual canonical event could not be proved; private details omitted",
      });
    } catch {
      // Existing failure receipt remains authoritative; never overwrite it.
    }
  }
  function beforeBuild(role, command, args) {
    if (seen.has("build-" + role)) os.deny();
    seen.add("build-" + role);
    binding.live(b);
    verifyProofs(b);
    os.assertPortFree(3000);
    os.assertPortFree(3001);
    return {
      claim: claim(root, process.pid),
      claimObservedAtEpochMs: Date.now(),
      portWasVacant: true,
      buildCallEpochMs: Date.now(),
      argv: [command, ...args],
    };
  }
  function completedBuild(role, before, buildChild, code, signal) {
    if (failed || !before || !buildChild || code !== 0 || signal) os.deny();
    const buildCompletedAtEpochMs = Date.now();
    verifyProofs(b);
    binding.live(b);
    const buildDirectory =
      role === "platform"
        ? path.join(root, ".next-csf-isolated/browser-app")
        : path.join(root, "lib/plugins/private/apps/csf/.next");
    let hashes;
    if (role === "platform") {
      const c = require("./observer-cache-policy.cjs"),
        appFile = path.join(buildDirectory, "server/app-paths-manifest.json"),
        policy = {
          enabled: true,
          sourceProofSha256: c.exactRuntimeCacheSources(),
          appPathsManifestSha256: os.hash(fs.readFileSync(appFile)),
          selectedPaths: b.capturePaths,
        };
      const mapped = c.cachePolicyFromCompiled(
        JSON.parse(fs.readFileSync(appFile)),
        b.capturePaths,
        policy.appPathsManifestSha256,
        policy.sourceProofSha256,
      );
      mapped.loopbackOrigins = [
        `http://127.0.0.1:${b.appPort}`,
        `http://127.0.0.1:${b.apiPort}`,
      ];
      hashes = os.freezeFiles(buildDirectory, (d, r, s) =>
        c.runtimeCacheEntrySafe(d, r, s, mapped),
      );
      c.runtimeCachePolicy(buildDirectory, policy, b.capturePaths, b, hashes);
    } else hashes = os.freezeFiles(buildDirectory);
    const value = os.exclusiveJSON(
      path.join(opt.outputDir, "canonical-build-" + role + ".json"),
      {
        schema: "lets-assist-linux-canonical-build-v1",
        materialized: true,
        observedBuildSuccess: true,
        observedBuildChild: true,
        role,
        ...common(),
        ...before,
        buildChild,
        exitCode: code,
        exitSignal: signal,
        buildCompletedAtEpochMs,
        artifactFrozenAtEpochMs: Date.now(),
        buildDirectory,
        buildId: fs
          .readFileSync(path.join(buildDirectory, "BUILD_ID"), "utf8")
          .trim(),
        compiledFileHashes: hashes,
      },
    );
    builds.set(role, value);
  }
  cp.spawn = function (command, args, options) {
    const buildRole = ["platform", "private"].find((r) =>
        exactSpawnCall(command, args, options, opt, r, "build"),
      ),
      role = ["platform", "private"].find((r) =>
        exactSpawnCall(command, args, options, opt, r),
      );
    let before = null;
    if (buildRole) {
      try {
        before = beforeBuild(buildRole, command, args);
      } catch {
        failure();
      }
    }
    const call = role ? Date.now() : null,
      argv = role ? [command, ...args] : null,
      spawnOptions = role
        ? { cwd: options.cwd, detached: true, stdio: [...options.stdio] }
        : null;
    // Exact original arguments/references and exact ChildProcess return value.
    const child = passthroughSpawn(original, this, arguments);
    if (buildRole) {
      let buildChild = null;
      child.once("spawn", () => {
        try {
          buildChild = os.identity(child.pid);
          if (
            buildChild.parentPid !== runner.pid ||
            buildChild.cwd !== options.cwd ||
            buildChild.executable !== b.node.path
          )
            os.deny();
        } catch {
          failure();
        }
      });
      child.once("error", failure);
      child.once("exit", (code, signal) => {
        try {
          completedBuild(buildRole, before, buildChild, code, signal);
        } catch {
          failure();
        }
      });
    }
    if (role) {
      if (seen.has("spawn-" + role)) {
        failure();
        return child;
      }
      seen.add("spawn-" + role);
      child.once("spawn", () => {
        const observed = Date.now();
        try {
          if (
            failed ||
            !builds.has("platform") ||
            !builds.has("private") ||
            builds.get(role).artifactFrozenAtEpochMs > call
          )
            os.deny();
          binding.live(b);
          verifyProofs(b);
          const listener = os.identity(child.pid);
          if (
            listener.parentPid !== runner.pid ||
            listener.cwd !== options.cwd ||
            listener.executable !== b.node.path
          )
            os.deny();
          os.sameIdentity(runner, os.identity(runner.pid));
          const value = {
            schema: "lets-assist-canonical-next-spawn-v1",
            materialized: true,
            observedSuccessfulSpawn: true,
            selectedChildEnvironmentMatches: true,
            role,
            ...common(),
            listener: { ...listener, argv },
            spawnCallEpochMs: call,
            spawnObservedEpochMs: observed,
            spawnOptions,
            nextTitleSourceProofSha256:
              b.proofHashes["next-title-source-proof.json"],
          };
          os.exclusiveJSON(
            path.join(
              opt.outputDir,
              role === "platform"
                ? "canonical-next-spawn.json"
                : "canonical-next-spawn-private.json",
            ),
            value,
          );
        } catch {
          failure();
        }
      });
    }
    return child;
  };
  mod.syncBuiltinESMExports();
}
function passthroughSpawn(original, receiver, args) {
  return Reflect.apply(original, receiver, args);
}
module.exports = {
  exactSpawnCall,
  freshOutput,
  passthroughSpawn,
  makeObserverOptIn,
};
if (process.env.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN)
  install(process.env.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN);
