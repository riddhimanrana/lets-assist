// Pure Linux event/receipt contracts; no runtime or network observation here.
import path from "node:path";
import { createRequire } from "node:module";
const os = createRequire(import.meta.url)("./linux-platform.cjs");
const same = (a, b, keys) => {
  if (keys.some((k) => a?.[k] !== b?.[k])) os.deny();
};
const tuple = [
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
  "bindingFile",
  "bindingSha256",
  "codeManifestSha256",
];
export function identityShape(p) {
  if (
    !p ||
    !Number.isInteger(p.pid) ||
    p.pid < 2 ||
    !Number.isInteger(p.uid) ||
    p.uid < 0 ||
    !Number.isInteger(p.parentPid) ||
    p.parentPid < 1 ||
    !path.isAbsolute(p.cwd ?? "") ||
    !path.isAbsolute(p.executable ?? "") ||
    !/^[a-f0-9-]{36}$/u.test(p.bootId ?? "") ||
    !/^\d+$/u.test(p.startTicks ?? "") ||
    p.startIdentity !== p.bootId + ":" + p.pid + ":" + p.startTicks ||
    !Number.isFinite(p.startedAtEpochMs) ||
    p.startedAtEpochMs <= 0 ||
    p.startClockPrecisionMs !== 1000
  )
    os.deny();
  return true;
}
export function validateBuild(build, b, role) {
  if (
    build?.schema !== "lets-assist-linux-canonical-build-v1" ||
    build.materialized !== true ||
    build.observedBuildSuccess !== true ||
    build.observedBuildChild !== true ||
    build.portWasVacant !== true ||
    build.exitCode !== 0 ||
    build.exitSignal !== null ||
    build.role !== role
  )
    os.deny();
  same(build, b, tuple);
  for (const k of ["node", "script"])
    if (JSON.stringify(build[k]) !== JSON.stringify(b[k])) os.deny();
  identityShape(build.runner);
  identityShape(build.buildChild);
  if (
    build.runner.uid !== b.uid ||
    build.runner.cwd !== b.repoRoot ||
    build.runner.executable !== b.node.path ||
    build.buildChild.parentPid !== build.runner.pid ||
    build.buildChild.uid !== b.uid ||
    build.buildChild.executable !== b.node.path ||
    build.buildChild.bootId !== build.runner.bootId
  )
    os.deny();
  const root =
      role === "platform"
        ? b.repoRoot
        : path.join(b.repoRoot, "lib/plugins/private/apps/csf"),
    dist = role === "platform" ? ".next-csf-isolated/browser-app" : ".next";
  if (
    build.buildDirectory !== path.join(root, dist) ||
    build.buildChild.cwd !== root ||
    JSON.stringify(build.argv) !==
      JSON.stringify([
        b.node.path,
        path.join(root, "node_modules/next/dist/bin/next"),
        "build",
        "--webpack",
      ])
  )
    os.deny();
  const t = [
    build.claimObservedAtEpochMs,
    build.buildCallEpochMs,
    build.buildCompletedAtEpochMs,
    build.artifactFrozenAtEpochMs,
    build.createdAtEpochMs,
  ];
  if (
    t.some((v) => !Number.isFinite(v) || v <= 0) ||
    t.some((v, i) => i && v < t[i - 1]) ||
    build.claim?.pid !== build.runner.pid ||
    build.claim.uid !== b.uid ||
    build.claim.mode !== 0o600 ||
    !Number.isInteger(build.claim.dev) ||
    !Number.isInteger(build.claim.ino)
  )
    os.deny();
  if (
    !/^[a-zA-Z0-9_-]+$/u.test(build.buildId ?? "") ||
    !build.compiledFileHashes ||
    typeof build.compiledFileHashes !== "object" ||
    Array.isArray(build.compiledFileHashes) ||
    Object.entries(build.compiledFileHashes).some(
      ([p, h]) => !os.safeRelative(p) || !os.SHA.test(h),
    ) ||
    [
      "BUILD_ID",
      "build-manifest.json",
      "routes-manifest.json",
      "required-server-files.json",
      "server/app-paths-manifest.json",
    ].some((f) => !build.compiledFileHashes[f]) ||
    !Object.keys(build.compiledFileHashes).some(
      (p) => p.startsWith("server/") && p.endsWith(".js"),
    ) ||
    !Object.keys(build.compiledFileHashes).some(
      (p) => p.startsWith("static/chunks/") && p.endsWith(".js"),
    )
  )
    os.deny();
  return true;
}
export function validateSpawn(spawn, b, build, role) {
  validateBuild(build, b, role);
  if (
    spawn?.schema !== "lets-assist-canonical-next-spawn-v1" ||
    spawn.materialized !== true ||
    spawn.observedSuccessfulSpawn !== true ||
    spawn.selectedChildEnvironmentMatches !== true ||
    spawn.role !== role
  )
    os.deny();
  same(spawn, b, tuple);
  os.sameIdentity(spawn.runner, build.runner);
  identityShape(spawn.listener);
  const root =
      role === "platform"
        ? b.repoRoot
        : path.join(b.repoRoot, "lib/plugins/private/apps/csf"),
    port = role === "platform" ? 3000 : 3001;
  if (
    spawn.listener.pid === spawn.runner.pid ||
    spawn.listener.parentPid !== spawn.runner.pid ||
    spawn.listener.uid !== b.uid ||
    spawn.listener.cwd !== root ||
    spawn.listener.executable !== b.node.path ||
    spawn.listener.bootId !== spawn.runner.bootId ||
    JSON.stringify(spawn.listener.argv) !==
      JSON.stringify([
        b.node.path,
        path.join(root, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ]) ||
    JSON.stringify(spawn.spawnOptions) !==
      JSON.stringify({
        cwd: root,
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      })
  )
    os.deny();
  if (
    !Number.isFinite(spawn.spawnCallEpochMs) ||
    !Number.isFinite(spawn.spawnObservedEpochMs) ||
    !Number.isFinite(spawn.createdAtEpochMs) ||
    build.artifactFrozenAtEpochMs > spawn.spawnCallEpochMs ||
    spawn.spawnObservedEpochMs < spawn.spawnCallEpochMs ||
    spawn.spawnObservedEpochMs - spawn.spawnCallEpochMs > 10000 ||
    spawn.createdAtEpochMs < spawn.spawnObservedEpochMs ||
    spawn.listener.startedAtEpochMs < spawn.spawnCallEpochMs - 1000 ||
    spawn.listener.startedAtEpochMs > spawn.spawnObservedEpochMs
  )
    os.deny();
  return true;
}
