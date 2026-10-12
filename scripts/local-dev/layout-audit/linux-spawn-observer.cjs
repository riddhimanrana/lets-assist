"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  mod = require("node:module");
const os = require("./linux-platform.cjs"),
  binding = require("./linux-binding.cjs");
const SELF = path.join(__dirname, "capture-spawn-observer.cjs");
const DIAGNOSTIC_PHASES = new Set([
  "before-build",
  "build-child-identity",
  "build-child-error",
  "build-exit",
  "build-outcome",
  "build-source-proof",
  "build-source-binding",
  "build-cache-source",
  "build-cache-route-map",
  "build-artifact-freeze",
  "build-cache-worker-proof",
  "build-receipt",
  "duplicate-start",
  "start-guards",
  "start-source-binding",
  "start-source-proof",
  "start-process",
  "start-receipt",
]);
const DIAGNOSTIC_MODULES = new Set([
  "linux-spawn-observer.cjs",
  "linux-platform.cjs",
  "linux-binding.cjs",
  "observer-cache-policy.cjs",
  "cache-contract-dependency.cjs",
]);
// Exact literal-to-code mapping only; raw error messages never leave this module.
const DIAGNOSTIC_REASON_CODES = new Map([
  ["Pinned embedded WASM cache source drifted", "CACHE_EMBEDDED_WASM_SOURCE"],
  ["Owned cache source proof required", "CACHE_SOURCE_OWNER"],
  ["Exact reviewed cache source proof required", "CACHE_SOURCE_CONTRACT"],
  ["Reviewed runtime cache source drifted", "CACHE_SOURCE_DRIFT"],
  [
    "Frozen compiled routes and selected capture paths required",
    "CACHE_ROUTE_MANIFEST",
  ],
  ["Canonical query-free selected cache route required", "CACHE_SELECTED_PATH"],
  [
    "Selected cache route lacks one positive compiled source owner",
    "CACHE_ROUTE_OWNER",
  ],
  ["Compiled page worker path refused", "CACHE_WORKER_PATH"],
  [
    "Exact reviewed source/compiled/selected-route cache policy required",
    "CACHE_POLICY_BINDING",
  ],
  [
    "Positive cache route worker lacks frozen compiled bytes",
    "CACHE_WORKER_BYTES",
  ],
  ["Bounded nonempty response cache data required", "CACHE_RESPONSE_SIZE"],
  ["Non-HTML cache payload refused", "CACHE_HTML_SHAPE"],
  ["Non-RSC cache payload refused", "CACHE_RSC_SHAPE"],
  ["Unreviewed cache payload extension refused", "CACHE_PAYLOAD_EXTENSION"],
  ["Unexpected response cache metadata refused", "CACHE_RESPONSE_META_SHAPE"],
  ["Response cache metadata owner mismatch", "CACHE_RESPONSE_META_OWNER"],
  ["Unsafe response cache segment paths", "CACHE_RESPONSE_SEGMENT_PATH"],
  ["Owned nonsymlink non-executable cache data required", "CACHE_DATA_OWNER"],
  ["Unknown image cache directory", "CACHE_IMAGE_NAMESPACE"],
  ["Non-raster/unexpected image cache data refused", "CACHE_IMAGE_SHAPE"],
  ["Unexpected fetch cache directory", "CACHE_FETCH_NAMESPACE"],
  ["Unexpected fetch cache key/data", "CACHE_FETCH_KEY"],
  ["Non-FETCH JSON cache record refused", "CACHE_FETCH_SHAPE"],
  ["Unreviewed fetch cache data URL", "CACHE_FETCH_URL"],
  ["Foreign fetch cache data refused", "CACHE_FETCH_ORIGIN"],
  [
    "Unknown response cache kind/source hash/selected path",
    "CACHE_RESPONSE_NAMESPACE",
  ],
  ["Unreviewed response cache segment", "CACHE_RESPONSE_SEGMENT"],
  ["Unknown response cache payload path/extension", "CACHE_RESPONSE_PATH"],
]);
function observerFailureDiagnostic(
  error,
  phase,
  role,
  ownedDirectory = __dirname,
) {
  const result = {
    phase: DIAGNOSTIC_PHASES.has(phase) ? phase : "unknown",
    role: ["platform", "private"].includes(role) ? role : "unknown",
    location: null,
    reasonCode: "unknown",
  };
  // Reading a message is solely for an exact literal lookup, never serialization.
  try {
    if (typeof error?.message === "string")
      result.reasonCode =
        DIAGNOSTIC_REASON_CODES.get(error.message) ?? "unknown";
  } catch {
    // Hostile/absent getters are diagnostically unknown.
  }
  let stack = "";
  try {
    if (typeof error?.stack === "string") stack = error.stack.slice(0, 65536);
  } catch {
    return result;
  }
  for (const frame of stack.split("\n").slice(1, 33)) {
    const match = frame.match(
      /((?:file:\/\/)?\/[^\n]+):(\d{1,6}):(\d{1,6})\)?$/u,
    );
    if (!match) continue;
    let file = match[1];
    try {
      if (file.startsWith("file://"))
        file = require("node:url").fileURLToPath(file);
    } catch {
      continue;
    }
    const ownModule = path.basename(file),
      line = Number(match[2]);
    if (
      DIAGNOSTIC_MODULES.has(ownModule) &&
      file === path.join(ownedDirectory, ownModule) &&
      line > 0 &&
      line <= 100000
    ) {
      const candidate = { module: ownModule, line };
      if (ownModule === "cache-contract-dependency.cjs") {
        // Prefer the cache policy caller over its generic throw boundary.
        if (!result.location) result.location = candidate;
        continue;
      }
      result.location = candidate;
      break;
    }
  }
  return result;
}
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
  function failure(error, phase, role) {
    const first = !failed;
    failed = true;
    if (!first) return;
    const diagnostic = observerFailureDiagnostic(error, phase, role);
    try {
      os.exclusiveJSON(path.join(opt.outputDir, "observer-failure.json"), {
        schema: "lets-assist-linux-observer-failure-v1",
        proved: false,
        reason:
          "Actual canonical event could not be proved; private details omitted",
        diagnostic,
      });
    } catch {
      // Existing failure receipt remains authoritative; never overwrite it.
    }
    // No message, stack, arguments, environment, paths or records are emitted.
    try {
      process.stderr.write(
        JSON.stringify({
          schema: "lets-assist-observer-diagnostic-v1",
          ...diagnostic,
        }) + "\n",
      );
    } catch {
      // Receipt still fails closed if the CI output stream has closed.
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
    let phase = "build-outcome";
    try {
      if (failed || !before || !buildChild || code !== 0 || signal) os.deny();
      const buildCompletedAtEpochMs = Date.now();
      phase = "build-source-proof";
      verifyProofs(b);
      phase = "build-source-binding";
      binding.live(b);
      const buildDirectory =
        role === "platform"
          ? path.join(root, ".next-csf-isolated/browser-app")
          : path.join(root, "lib/plugins/private/apps/csf/.next");
      let hashes;
      if (role === "platform") {
        phase = "build-cache-source";
        const c = require("./observer-cache-policy.cjs"),
          appFile = path.join(buildDirectory, "server/app-paths-manifest.json"),
          policy = {
            enabled: true,
            sourceProofSha256: c.exactRuntimeCacheSources(),
            appPathsManifestSha256: os.hash(fs.readFileSync(appFile)),
            selectedPaths: b.capturePaths,
          };
        phase = "build-cache-route-map";
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
        phase = "build-artifact-freeze";
        hashes = os.freezeFiles(buildDirectory, (d, r, s) =>
          c.runtimeCacheEntrySafe(d, r, s, mapped),
        );
        phase = "build-cache-worker-proof";
        c.runtimeCachePolicy(buildDirectory, policy, b.capturePaths, b, hashes);
      } else {
        phase = "build-artifact-freeze";
        hashes = os.freezeFiles(buildDirectory);
      }
      phase = "build-receipt";
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
    } catch (error) {
      failure(error, phase, role);
      throw error;
    }
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
      } catch (error) {
        failure(error, "before-build", buildRole);
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
        } catch (error) {
          failure(error, "build-child-identity", buildRole);
        }
      });
      child.once("error", (error) =>
        failure(error, "build-child-error", buildRole),
      );
      child.once("exit", (code, signal) => {
        try {
          completedBuild(buildRole, before, buildChild, code, signal);
        } catch (error) {
          failure(error, "build-exit", buildRole);
        }
      });
    }
    if (role) {
      if (seen.has("spawn-" + role)) {
        failure(null, "duplicate-start", role);
        return child;
      }
      seen.add("spawn-" + role);
      child.once("spawn", () => {
        const observed = Date.now();
        let phase = "start-guards";
        try {
          if (
            failed ||
            !builds.has("platform") ||
            !builds.has("private") ||
            builds.get(role).artifactFrozenAtEpochMs > call
          )
            os.deny();
          phase = "start-source-binding";
          binding.live(b);
          phase = "start-source-proof";
          verifyProofs(b);
          phase = "start-process";
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
          phase = "start-receipt";
          os.exclusiveJSON(
            path.join(
              opt.outputDir,
              role === "platform"
                ? "canonical-next-spawn.json"
                : "canonical-next-spawn-private.json",
            ),
            value,
          );
        } catch (error) {
          failure(error, phase, role);
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
  observerFailureDiagnostic,
};
if (process.env.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN)
  install(process.env.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN);
