#!/usr/bin/env node
// Future actual owned runtime collector. No launch, DB mutation or provider request.
import fs from "node:fs";
import { pluginPolicyFromCompiled } from "./plugin-reader-contract.mjs";
import {
  integrationPolicyFromCompiled,
  verifyIntegrationFixture,
} from "./integration-reader-contract.mjs";
import {
  invitationPolicyFromCompiled,
  verifyInvitationFixture,
} from "./invitation-reader-contract.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { BINDING, REPO, requireLiveBinding } from "./linux-binding.mjs";
import {
  digest,
  BUILD_DIST_DIR,
  BUILD_ARTIFACTS,
  routeSafe,
  proofContracts,
} from "./capture-contract.mjs";
import {
  exactCompiledFiles,
  bindingShapeGuard,
  verifyLiveRuntime,
  validateCaptureNames,
} from "./capture-runtime-contract.mjs";
import {
  runtimeCachePolicy,
  exactRuntimeCacheSources,
} from "./capture-cache-contract.mjs";
import { readActionPolicyFromCompiled } from "./capture-effects-contract.mjs";
import { validateBuild, validateSpawn } from "./linux-proof-contract.mjs";
const require = createRequire(import.meta.url),
  os = require("./linux-platform.cjs"),
  SELF = fs.realpathSync(
    new URL("./capture-spawn-observer.cjs", import.meta.url).pathname,
  );
export async function servedProof(directory, hashes, buildId, port) {
  const manifest = `static/${buildId}/_buildManifest.js`,
    chunk = Object.keys(hashes).find((k) =>
      /^static\/chunks\/.+\.js$/u.test(k),
    );
  if (!hashes[manifest] || !chunk) os.deny();
  const artifacts = [manifest, chunk].map((relativeBuildFile) => ({
    relativeBuildFile,
    urlPath: `/_next/${relativeBuildFile}`,
    sha256: hashes[relativeBuildFile],
  }));
  for (const a of artifacts) {
    const response = await fetch(`http://127.0.0.1:${port}${a.urlPath}`, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (
      response.status !== 200 ||
      digest(Buffer.from(await response.arrayBuffer())) !== a.sha256 ||
      digest(fs.readFileSync(path.join(directory, a.relativeBuildFile))) !==
        a.sha256
    )
      os.deny();
  }
  return artifacts;
}
export function verifyEventSet({
  binding,
  opt,
  build,
  privateBuild,
  spawn,
  privateSpawn,
}) {
  if (
    opt.bindingFile !== binding.bindingFile ||
    opt.bindingSha256 !== binding.bindingSha256 ||
    opt.codeManifestSha256 !== binding.codeManifestSha256 ||
    opt.enabled !== true ||
    opt.template !== false ||
    opt.allowRuntimeObservation !== true
  )
    os.deny();
  validateBuild(build, binding, "platform");
  validateBuild(privateBuild, binding, "private");
  validateSpawn(spawn, binding, build, "platform");
  validateSpawn(privateSpawn, binding, privateBuild, "private");
  os.sameIdentity(build.runner, privateBuild.runner);
  os.sameIdentity(spawn.runner, privateSpawn.runner);
  for (const event of [build, privateBuild, spawn, privateSpawn])
    if (
      event.optInFile !== opt.optInFile ||
      event.optInSha256 !== opt.optInSha256 ||
      event.observer?.path !== SELF ||
      event.observer.sha256 !== digest(fs.readFileSync(SELF))
    )
      os.deny();
  return true;
}
export async function main(
  optFile,
  fixtureFile,
  supportDir,
  captureName,
  enableReads = false,
) {
  requireLiveBinding();
  os.privateDir(supportDir);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/u.test(captureName ?? "")) os.deny();
  const opt = os.readCreatedJSON(optFile);
  opt.optInFile = optFile;
  opt.optInSha256 = digest(fs.readFileSync(optFile));
  const parent = path.join(REPO, ".artifacts/layout-audit-spawn");
  if (path.dirname(opt.outputDir) !== parent) os.deny();
  os.privateDir(opt.outputDir);
  const expectedNames = [
    "canonical-build-platform.json",
    "canonical-build-private.json",
    "canonical-next-spawn-private.json",
    "canonical-next-spawn.json",
  ];
  if (
    JSON.stringify(fs.readdirSync(opt.outputDir).sort()) !==
    JSON.stringify(expectedNames.sort())
  )
    os.deny();
  const file = (n) => path.join(opt.outputDir, n),
    build = os.readCreatedJSON(file("canonical-build-platform.json")),
    privateBuild = os.readCreatedJSON(file("canonical-build-private.json")),
    spawn = os.readCreatedJSON(file("canonical-next-spawn.json")),
    privateSpawn = os.readCreatedJSON(
      file("canonical-next-spawn-private.json"),
    );
  verifyEventSet({
    binding: BINDING,
    opt,
    build,
    privateBuild,
    spawn,
    privateSpawn,
  });
  process.env.CSF_ISOLATED_WORK_DIR = BINDING.workDir;
  const dv = await import(
      pathToFileURL(path.join(REPO, "scripts/local-dev/dv-local-env.mjs"))
    ),
    marker = dv.inspectCsfIsolatedWorkDir(BINDING.workDir);
  dv.getCsfIsolatedSupabaseEnv();
  for (const k of [
    "workDir",
    "runId",
    "projectId",
    "apiPort",
    "databasePort",
    "databaseVolume",
  ])
    if (marker[k] !== BINDING[k]) os.deny();
  const actualClaim = `/tmp/lets-assist-csf-isolated-claims-${BINDING.uid}/app-port-3000/owner`;
  os.ownFile(actualClaim);
  const claimStat = fs.statSync(actualClaim);
  if (
    !new RegExp(
      "^pid=" + spawn.runner.pid + "\\ntoken=[a-f0-9]{32}\\n$",
      "u",
    ).test(fs.readFileSync(actualClaim, "utf8")) ||
    claimStat.dev !== build.claim.dev ||
    claimStat.ino !== build.claim.ino
  )
    os.deny();
  os.sameIdentity(os.identity(spawn.runner.pid), spawn.runner);
  os.sameIdentity(os.identity(spawn.listener.pid), spawn.listener);
  os.sameIdentity(
    os.identity(privateSpawn.listener.pid),
    privateSpawn.listener,
  );
  os.assertListener(spawn.listener, 3000);
  os.assertListener(privateSpawn.listener, 3001);
  const directory = path.join(REPO, BUILD_DIST_DIR),
    cachePolicy = {
      enabled: true,
      sourceProofSha256: exactRuntimeCacheSources(),
      appPathsManifestSha256:
        build.compiledFileHashes["server/app-paths-manifest.json"],
      selectedPaths: BINDING.capturePaths,
    };
  const cache = runtimeCachePolicy(
    directory,
    cachePolicy,
    BINDING.capturePaths,
    BINDING,
    build.compiledFileHashes,
  );
  exactCompiledFiles(directory, build.compiledFileHashes, cache);
  if (
    JSON.stringify(os.freezeFiles(privateBuild.buildDirectory)) !==
    JSON.stringify(privateBuild.compiledFileHashes)
  )
    os.deny();
  const fixture = os.readCreatedJSON(fixtureFile),
    seed = await import(
      pathToFileURL(
        path.join(REPO, "scripts/local-dev/seed-platform-fixtures.mjs"),
      )
    );
  if (fixture.retainedHoursCount !== 0) os.deny();
  proofContracts(
    fixture,
    marker,
    seed.buildSeedFixtureSets(true).seededAccounts,
    null,
  );
  const readProof = JSON.parse(
    fs.readFileSync(
      new URL("./proof-data/read-action-source-review.json", import.meta.url),
    ),
  );
  let readActionPolicy = { enabled: false, reviewed: false };
  let invitationReadPolicy = { enabled: false, reviewed: false };
  let integrationReadPolicy = { enabled: false, reviewed: false };
  let pluginReadPolicy = { enabled: false, reviewed: false };
  if (enableReads) {
    const meta = path.join(directory, "server/server-reference-manifest.json");
    os.ownFile(meta, false);
    const bytes = fs.readFileSync(meta);
    if (
      digest(bytes) !==
      build.compiledFileHashes["server/server-reference-manifest.json"]
    )
      os.deny();
    readActionPolicy = readActionPolicyFromCompiled(
      JSON.parse(bytes),
      REPO,
      digest(bytes),
      readProof.sourceHashes,
    );
    if (readActionPolicy.approvedActions?.length !== 3) os.deny();
    readActionPolicy.enabled = true;
    readActionPolicy.reviewed = true;
    const developer = fixture.baselineActors.find((a) => a.key === "developer");
    verifyInvitationFixture(fixture.invitationReaderOrganization, {
      kind: "baseline",
      key: "developer",
      id: developer?.userId,
    });
    invitationReadPolicy = invitationPolicyFromCompiled(
      JSON.parse(bytes),
      REPO,
      digest(bytes),
      readProof.invitationReaderSourceHashes,
    );
    verifyIntegrationFixture(
      fixture.integrationReader,
      fixture.invitationReaderOrganization,
      {
        kind: "baseline",
        key: "developer",
        id: developer?.userId,
      },
    );
    integrationReadPolicy = integrationPolicyFromCompiled(
      JSON.parse(bytes),
      REPO,
      digest(bytes),
      readProof.integrationReaderSourceHashes,
    );
    pluginReadPolicy = pluginPolicyFromCompiled(
      JSON.parse(bytes),
      REPO,
      digest(bytes),
      readProof.pluginReaderSourceHashes,
    );
  }
  const runtime = {
    schema: "lets-assist-layout-runtime-binding-v1",
    template: false,
    materialized: true,
    fromCanonicalLaunch: true,
    sourceClean: true,
    buildFinalized: true,
    repoRoot: REPO,
    rootHead: BINDING.rootHead,
    privateHead: BINDING.privateHead,
    dirtyDiffSha256: BINDING.dirtyDiffSha256,
    workDir: BINDING.workDir,
    runId: BINDING.runId,
    projectId: BINDING.projectId,
    appPort: 3000,
    apiPort: BINDING.apiPort,
    databasePort: BINDING.databasePort,
    buildId: build.buildId,
    buildDistDir: BUILD_DIST_DIR,
    uid: BINDING.uid,
    script: BINDING.script,
    node: BINDING.node,
    startMode: "start",
    buildCompletedAtEpochMs: build.buildCompletedAtEpochMs,
    portClaimedAtEpochMs: build.claimObservedAtEpochMs,
    portWasVacant: true,
    runner: spawn.runner,
    listener: spawn.listener,
    compiledFileHashes: build.compiledFileHashes,
    servedArtifacts: await servedProof(
      directory,
      build.compiledFileHashes,
      build.buildId,
      3000,
    ),
    spawnReceiptFile: file("canonical-next-spawn.json"),
    spawnReceiptSha256: digest(
      fs.readFileSync(file("canonical-next-spawn.json")),
    ),
    spawnObserver: opt.observer,
    spawnObserverOptInFile: optFile,
    spawnObserverOptInSha256: opt.optInSha256,
    listenerTitle: "next-server (v16.4.0)",
    nextTitleSourceProofSha256:
      BINDING.proofHashes["next-title-source-proof.json"],
    cachePolicy,
    bindingFile: BINDING.bindingFile,
    bindingSha256: BINDING.bindingSha256,
    codeManifestSha256: BINDING.codeManifestSha256,
    eventReceiptHashes: Object.fromEntries(
      expectedNames.map((n) => [n, digest(fs.readFileSync(file(n)))]),
    ),
    privateRuntime: {
      port: 3001,
      buildDirectory: privateBuild.buildDirectory,
      buildId: privateBuild.buildId,
      compiledFileHashes: privateBuild.compiledFileHashes,
      listener: privateSpawn.listener,
      servedArtifacts: await servedProof(
        privateBuild.buildDirectory,
        privateBuild.compiledFileHashes,
        privateBuild.buildId,
        3001,
      ),
    },
  };
  const expected = {
    repoRoot: REPO,
    ...os.sourceIdentity(REPO, BINDING),
    workDir: BINDING.workDir,
    runId: BINDING.runId,
    projectId: BINDING.projectId,
    appPort: 3000,
    apiPort: BINDING.apiPort,
    databasePort: BINDING.databasePort,
    buildId: build.buildId,
    cacheSelectedPaths: BINDING.capturePaths,
  };
  runtime.createdAtEpochMs = Date.now();
  bindingShapeGuard(runtime, expected);
  await verifyLiveRuntime(runtime, expected, directory);
  requireLiveBinding();
  const runtimeFile = path.join(supportDir, "runtime-binding.json");
  os.exclusiveJSON(runtimeFile, runtime);
  const captureTemplate = os.readJSON(BINDING.captureTemplateFile);
  if (
    digest(fs.readFileSync(BINDING.captureTemplateFile)) !==
    BINDING.captureTemplateSha256
  )
    os.deny();
  validateCaptureNames(captureTemplate.captures);
  for (const c of captureTemplate.captures) {
    routeSafe(c.route);
    for (const r of c.expectedRoutes) routeSafe(r);
  }
  const outputParent = path.join(REPO, ".artifacts/layout-audit");
  if (!fs.existsSync(outputParent)) fs.mkdirSync(outputParent, { mode: 0o700 });
  os.canonical(outputParent);
  const captureOutput = path.join(outputParent, captureName);
  fs.mkdirSync(captureOutput, { mode: 0o700 });
  const manifest = {
    ...captureTemplate,
    template: false,
    repoRoot: REPO,
    rootHead: BINDING.rootHead,
    privateHead: BINDING.privateHead,
    dirtyDiffSha256: BINDING.dirtyDiffSha256,
    syntheticOnly: true,
    seedMode: "csf-isolated-v1",
    serverMode: "production",
    isolatedWorkDir: BINDING.workDir,
    projectId: BINDING.projectId,
    appPort: 3000,
    runnerPid: spawn.runner.pid,
    runtimeBindingFile: runtimeFile,
    runtimeBindingSha256: digest(fs.readFileSync(runtimeFile)),
    buildDistDir: BUILD_DIST_DIR,
    buildId: build.buildId,
    buildArtifactHashes: Object.fromEntries(
      BUILD_ARTIFACTS.map((n) => [n, build.compiledFileHashes[n]]),
    ),
    outputDir: captureOutput,
    fixtureProofFile: fixtureFile,
    fixtureProofSha256: digest(fs.readFileSync(fixtureFile)),
    readActionPolicy,
    invitationReadPolicy,
    integrationReadPolicy,
    pluginReadPolicy,
  };
  const manifestFile = path.join(supportDir, "capture-manifest.json");
  os.exclusiveJSON(manifestFile, manifest);
  process.stdout.write(
    JSON.stringify({
      manifestFile,
      runtimeBindingFile: runtimeFile,
      runtimeBindingSha256: manifest.runtimeBindingSha256,
      fixtureProofSha256: manifest.fixtureProofSha256,
      captureCandidates: manifest.captures.length,
      pixelsInspected: 0,
      completeVisualAudit: false,
    }) + "\n",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(
    ...process.argv.slice(2, 6),
    process.argv[6] === "--enable-reviewed-read-actions",
  );
