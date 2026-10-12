// Meaningful offline regressions for independently confirmed guard bypasses.
// Creates only owned disposable fixture files; never observes a real runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  REPO,
  BUILD_DIST_DIR,
  BUILD_ARTIFACTS,
  digest,
  localRequestSafe,
  verifyStaticImageProof,
  staticImageTargetSafe,
  verifyFixtureRows,
} from "./capture-contract.mjs";
import { exactRuntimeCacheSources } from "./capture-cache-contract.mjs";
import {
  SPAWN_OBSERVER,
  exactNextTitleSource,
  spawnBindingGuard,
} from "./capture-spawn-contract.mjs";
import { createRequire } from "node:module";
const { exactSpawnCall } = createRequire(import.meta.url)(
  "./capture-spawn-observer.cjs",
);
import {
  newCaptureOutput,
  validateCaptureNames,
  createExclusiveReceipt,
  appendDurableReceipt,
  freezeCompiledFiles,
  exactCompiledFiles,
  bindingShapeGuard,
  runtimeBindingGuard,
  readRuntimeBinding,
} from "./capture-runtime-contract.mjs";
export function runRepairGuards({ contracts, users, profiles }) {
  let checks = 0;
  const categories = { image: 0, identity: 0, runtime: 0, output: 0 };
  const allow = (category, fn) => {
    fn();
    checks++;
    categories[category]++;
  };
  const deny = (category, fn) => {
    assert.throws(fn);
    checks++;
    categories[category]++;
  };
  const tmp = fs.realpathSync(
    fs.mkdtempSync(new URL("./.offline-repair-", import.meta.url).pathname),
  );
  const app = "http://127.0.0.1:3057",
    api = "http://127.0.0.1:55081";
  try {
    const pub = path.join(tmp, "public");
    fs.mkdirSync(pub);
    fs.writeFileSync(path.join(pub, "safe.png"), "OFFLINE ONLY");
    for (const file of ["next.config.ts", "proxy.ts"])
      fs.writeFileSync(path.join(tmp, file), "OFFLINE ONLY");
    const imageProof = {
      schema: "lets-assist-static-image-proof-v1",
      sourceOnly: true,
      repoRoot: tmp,
      assets: [
        {
          route: "/safe.png",
          sourceFile: "public/safe.png",
          sha256: digest(fs.readFileSync(path.join(pub, "safe.png"))),
        },
      ],
      routingSourceHashes: Object.fromEntries(
        ["next.config.ts", "proxy.ts"].map((f) => [
          f,
          digest(fs.readFileSync(path.join(tmp, f))),
        ]),
      ),
    };
    const images = verifyStaticImageProof(tmp, imageProof, ["public/safe.png"]);
    allow("image", () => staticImageTargetSafe("/safe.png", images));
    allow("image", () =>
      localRequestSafe(
        `${app}/_next/image?url=%2Fsafe.png&w=256&q=75`,
        app,
        api,
        images,
      ),
    );
    // These three targets were accepted by the original frozen guard, despite
    // being refused when visited directly. Next internally GETs them.
    for (const target of [
      "/anonymous/OFFLINE_ONLY/confirm?token=OFFLINE_ONLY",
      "/logout",
      "/api/cron/auto-publish-hours",
      "/anonymous/OFFLINE_ONLY/confirm.png?token=OFFLINE_ONLY",
      "/api/cron/auto-publish-hours.png",
      "/safe.png?token=OFFLINE_ONLY",
      "/safe.png?anything=x",
      "/safe.png#fragment",
      "//remote.test/safe.png",
      "http://127.0.0.1:3057/logout",
      "/untracked.png",
      "/safe.png/../logout",
      "/%73afe.png",
      "/safe.png%3Ftoken=OFFLINE_ONLY",
      "/safe.png%253Ftoken=x",
      "/safe.png/other",
      "/safe.png\\other",
    ])
      deny("image", () =>
        localRequestSafe(
          `${app}/_next/image?url=${encodeURIComponent(target)}&w=256&q=75`,
          app,
          api,
          images,
        ),
      );
    for (const suffix of ["&url=%2Flogout", "&w=512", "&q=80", "&extra=true"])
      deny("image", () =>
        localRequestSafe(
          `${app}/_next/image?url=%2Fsafe.png&w=256&q=75${suffix}`,
          app,
          api,
          images,
        ),
      );
    for (const prefix of ["/_next/%69mage", "/_next/image/"])
      deny("image", () =>
        localRequestSafe(
          `${app}${prefix}?url=%2Flogout&w=256&q=75`,
          app,
          api,
          images,
        ),
      );
    for (const query of [
      "url=%2Fsafe.png&w=0&q=75",
      "url=%2Fsafe.png&w=256&q=0",
      "url=%2Fsafe.png&w=256&q=101",
      "url=%2Fsafe.png&w=256",
      "url=%2Fsafe.png&w=256&q=75&q=75",
    ])
      deny("image", () =>
        localRequestSafe(`${app}/_next/image?${query}`, app, api, images),
      );
    deny("image", () =>
      localRequestSafe(
        `${api}/_next/image?url=%2Fsafe.png&w=256&q=75`,
        app,
        api,
        images,
      ),
    );
    deny("image", () =>
      localRequestSafe(
        `${app.replace("http://", "http://unexpected@")}/_next/image?url=%2Fsafe.png&w=256&q=75`,
        app,
        api,
        images,
      ),
    );
    for (const change of [
      { route: "/../safe.png", sourceFile: "public/../safe.png" },
      {
        route: "/api/cron/action.png",
        sourceFile: "public/api/cron/action.png",
      },
      { sourceFile: "public/untracked.png" },
      { sha256: "0".repeat(64) },
    ])
      deny("image", () =>
        verifyStaticImageProof(
          tmp,
          { ...imageProof, assets: [{ ...imageProof.assets[0], ...change }] },
          ["public/safe.png"],
        ),
      );
    deny("image", () =>
      verifyStaticImageProof(
        tmp,
        { ...imageProof, assets: [imageProof.assets[0], imageProof.assets[0]] },
        ["public/safe.png"],
      ),
    );
    fs.writeFileSync(path.join(pub, "safe.png"), "CHANGED");
    deny("image", () => staticImageTargetSafe("/safe.png", images));
    fs.unlinkSync(path.join(pub, "safe.png"));
    fs.writeFileSync(path.join(tmp, "outside.png"), "OFFLINE ONLY");
    fs.symlinkSync(path.join(tmp, "outside.png"), path.join(pub, "safe.png"));
    deny("image", () => staticImageTargetSafe("/safe.png", images));
    deny("image", () =>
      verifyStaticImageProof(tmp, imageProof, ["public/safe.png"]),
    );
    fs.unlinkSync(path.join(pub, "safe.png"));
    fs.writeFileSync(path.join(pub, "safe.png"), "OFFLINE ONLY");
    fs.writeFileSync(path.join(tmp, "proxy.ts"), "CHANGED");
    deny("image", () =>
      verifyStaticImageProof(tmp, imageProof, ["public/safe.png"]),
    );

    const nonAdmin = contracts.findIndex(
        (a) => a.kind === "baseline" && !a.superAdmin,
      ),
      admin = contracts.findIndex((a) => a.kind === "baseline" && a.superAdmin),
      hours = contracts.findIndex((a) => a.kind === "hours");
    assert(nonAdmin >= 0 && admin >= 0 && hours >= 0);
    for (const metadata of [
      { role: "super_admin" },
      { is_super_admin: true },
      { role: "super_admin", is_super_admin: true },
      { role: "staff" },
      { is_super_admin: false },
      { local_fixture: true },
      { provider: "google" },
      { providers: ["email", "google"] },
      { unseeded: "value" },
    ]) {
      const bad = structuredClone(users);
      bad[nonAdmin].app_metadata = metadata;
      deny("identity", () => verifyFixtureRows(contracts, bad, profiles));
    }
    const ordinaryProviders = structuredClone(users);
    for (let i = 0; i < contracts.length; i++)
      if (contracts[i].kind === "baseline")
        Object.assign(ordinaryProviders[i].app_metadata, {
          provider: "email",
          providers: ["email"],
        });
    allow("identity", () =>
      verifyFixtureRows(contracts, ordinaryProviders, profiles),
    );
    // Every baseline role and the full 1,110 retained actors must have null
    // profile phones. Check each baseline identity, not just one example.
    for (let i = 0; i < contracts.length; i++)
      if (contracts[i].kind === "baseline") {
        const bad = structuredClone(profiles);
        bad[i].phone = "+15550000123";
        deny("identity", () => verifyFixtureRows(contracts, users, bad));
      }
    for (const i of [nonAdmin, admin, hours]) {
      for (const value of ["", undefined]) {
        const bad = structuredClone(profiles);
        if (value === undefined) delete bad[i].phone;
        else bad[i].phone = value;
        deny("identity", () => verifyFixtureRows(contracts, users, bad));
      }
      for (const value of ["+15550000123", undefined]) {
        const bad = structuredClone(users);
        if (value === undefined) delete bad[i].phone;
        else bad[i].phone = value;
        deny("identity", () => verifyFixtureRows(contracts, bad, profiles));
      }
      for (const change of [
        { role: "service_role" },
        { aud: "anon" },
        { user_metadata: { ...users[i].user_metadata, phone: "OFFLINE_ONLY" } },
        { user_metadata: { ...users[i].user_metadata, role: "super_admin" } },
      ]) {
        const bad = structuredClone(users);
        Object.assign(bad[i], change);
        deny("identity", () => verifyFixtureRows(contracts, bad, profiles));
      }
    }
    for (const change of [
      { role: "super_admin" },
      { is_super_admin: true },
      { provider: "email" },
      { local_fixture_run_id: "different" },
    ]) {
      const bad = structuredClone(users);
      Object.assign(bad[hours].app_metadata, change);
      deny("identity", () => verifyFixtureRows(contracts, bad, profiles));
    }
    const hoursPhone = structuredClone(profiles);
    hoursPhone[hours].phone = "+15550000123";
    deny("identity", () => verifyFixtureRows(contracts, users, hoursPhone));
    const missingAdmin = structuredClone(users);
    delete missingAdmin[admin].app_metadata.is_super_admin;
    deny("identity", () =>
      verifyFixtureRows(contracts, missingAdmin, profiles),
    );
    const nullAuthPhone = structuredClone(users);
    for (const u of nullAuthPhone) u.phone = null;
    allow("identity", () =>
      verifyFixtureRows(contracts, nullAuthPhone, profiles),
    );

    const build = path.join(tmp, BUILD_DIST_DIR);
    fs.mkdirSync(path.join(build, "server/chunks"), { recursive: true });
    fs.mkdirSync(path.join(build, "static/offline-build"), { recursive: true });
    fs.mkdirSync(path.join(build, "static/chunks"), { recursive: true });
    for (const f of BUILD_ARTIFACTS)
      fs.writeFileSync(path.join(build, f), "OFFLINE ONLY");
    fs.writeFileSync(
      path.join(build, "server/chunks/worker.js"),
      "WORKER ORIGINAL",
    );
    fs.writeFileSync(
      path.join(build, "static/offline-build/_buildManifest.js"),
      "MANIFEST ORIGINAL",
    );
    fs.writeFileSync(
      path.join(build, "static/chunks/app.js"),
      "CHUNK ORIGINAL",
    );
    fs.writeFileSync(
      path.join(build, "prerender-manifest.json"),
      "ROOT METADATA",
    );
    // Actual framework component spellings: dynamic, catch-all, optional catch-all,
    // route group and parallel/intercepted slot. These are literal filenames.
    const nextPaths = [
      "server/app/projects/[id]/page.js",
      "server/app/(landing)/page.js",
      "server/app/@modal/(.)projects/[id]/page.js",
      "server/app/[...slug]/page.js",
      "server/app/[[...slug]]/page.js",
      "static/chunks/app/(landing)/page-offline.js",
    ];
    for (const f of nextPaths) {
      fs.mkdirSync(path.dirname(path.join(build, f)), { recursive: true });
      fs.writeFileSync(path.join(build, f), "NEXT LITERAL WORKER " + f);
    }
    const hashes = freezeCompiledFiles(build);
    allow("runtime", () => exactCompiledFiles(build, hashes));
    for (const f of nextPaths)
      allow("runtime", () =>
        assert.equal(hashes[f], digest(fs.readFileSync(path.join(build, f)))),
      );
    for (const f of [
      "server/chunks/bad\\worker.js",
      "server/chunks/worker\u0001.js",
      "server/chunks/C:worker.js",
      "server/chunks/worker%2ejs",
    ]) {
      fs.writeFileSync(path.join(build, f), "UNSAFE LITERAL COMPONENT");
      deny("runtime", () => freezeCompiledFiles(build));
      fs.unlinkSync(path.join(build, f));
    }
    const nextWorker = path.join(build, "server/app/projects/[id]/page.js"),
      originalNextWorker = fs.readFileSync(nextWorker);
    fs.unlinkSync(nextWorker);
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.writeFileSync(nextWorker, originalNextWorker);
    const extraNextWorker = path.join(
      build,
      "server/app/projects/[id]/page.js.bak",
    );
    fs.writeFileSync(extraNextWorker, "UNDECLARED WORKER");
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.unlinkSync(extraNextWorker);
    const knownDir = path.join(build, "server/app/projects/[id]"),
      siblingDir = path.join(build, "server/app/projects/[other]");
    fs.renameSync(knownDir, siblingDir);
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.renameSync(siblingDir, knownDir);
    fs.unlinkSync(nextWorker);
    fs.symlinkSync(path.join(tmp, "outside.png"), nextWorker);
    deny("runtime", () => freezeCompiledFiles(build));
    fs.unlinkSync(nextWorker);
    fs.writeFileSync(nextWorker, originalNextWorker);
    const linkedSlot = path.join(build, "server/app/@foreign");
    fs.symlinkSync(path.join(tmp, "public"), linkedSlot);
    deny("runtime", () => freezeCompiledFiles(build));
    fs.unlinkSync(linkedSlot);
    // Five original top-level checks remain unchanged during these byte attacks.
    for (const f of [
      "server/chunks/worker.js",
      "static/chunks/app.js",
      "prerender-manifest.json",
      ...nextPaths,
    ]) {
      const original = fs.readFileSync(path.join(build, f));
      fs.writeFileSync(path.join(build, f), "TAMPERED");
      deny("runtime", () => exactCompiledFiles(build, hashes));
      for (const manifest of BUILD_ARTIFACTS)
        assert.equal(
          digest(fs.readFileSync(path.join(build, manifest))),
          hashes[manifest],
        );
      fs.writeFileSync(path.join(build, f), original);
    }
    fs.writeFileSync(path.join(build, "server/chunks/extra.js"), "EXTRA");
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.unlinkSync(path.join(build, "server/chunks/extra.js"));
    const saved = fs.readFileSync(path.join(build, "static/chunks/app.js"));
    fs.unlinkSync(path.join(build, "static/chunks/app.js"));
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.writeFileSync(path.join(build, "static/chunks/app.js"), saved);
    fs.symlinkSync(
      path.join(tmp, "outside.png"),
      path.join(build, "static/chunks/symlink.js"),
    );
    deny("runtime", () => exactCompiledFiles(build, hashes));
    fs.unlinkSync(path.join(build, "static/chunks/symlink.js"));
    const expected = {
      repoRoot: REPO,
      rootHead: "1".repeat(40),
      privateHead: "2".repeat(40),
      dirtyDiffSha256: "3".repeat(64),
      workDir: "/private/tmp/OFFLINE_ONLY",
      runId: "offline-only",
      projectId: "lets-assist-csf-browser-offline-only",
      appPort: 3057,
      apiPort: 55081,
      databasePort: 55082,
      buildId: "offline-build",
      cacheSelectedPaths: ["/"],
    };
    const node = "/OFFLINE_ONLY/bin/node",
      uid = process.getuid(),
      script = path.join(
        REPO,
        "scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
      );
    const runner = {
        pid: 991001,
        uid,
        cwd: REPO,
        startIdentity: "OFFLINE RUNNER",
        startedAtEpochMs: 1000,
        argv: [node, script],
      },
      listener = {
        pid: 991002,
        uid,
        cwd: REPO,
        startIdentity: "OFFLINE LISTENER",
        startedAtEpochMs: 4000,
        argv: [
          node,
          path.join(REPO, "node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3057",
        ],
      };
    const receipt = {
      schema: "lets-assist-layout-runtime-binding-v1",
      materialized: true,
      fromCanonicalLaunch: true,
      sourceClean: true,
      buildFinalized: true,
      ...expected,
      uid,
      script: { path: script, sha256: "4".repeat(64) },
      node: { path: node, sha256: "5".repeat(64) },
      buildDistDir: BUILD_DIST_DIR,
      startMode: "start",
      createdAtEpochMs: 5000,
      buildCompletedAtEpochMs: 2000,
      portClaimedAtEpochMs: 3000,
      portWasVacant: true,
      runner,
      listener,
      compiledFileHashes: hashes,
      servedArtifacts: [
        "static/offline-build/_buildManifest.js",
        "static/chunks/app.js",
      ].map((f) => ({
        relativeBuildFile: f,
        urlPath: `/_next/${f}`,
        sha256: hashes[f],
      })),
    };
    const titleProof = exactNextTitleSource();
    Object.assign(receipt, {
      cachePolicy: {
        enabled: true,
        sourceProofSha256: exactRuntimeCacheSources(),
        appPathsManifestSha256: hashes["server/app-paths-manifest.json"],
        selectedPaths: ["/"],
      },
      listenerTitle: titleProof.title,
      nextTitleSourceProofSha256: titleProof.sourceProofSha256,
      spawnObserver: {
        path: SPAWN_OBSERVER,
        sha256: digest(fs.readFileSync(SPAWN_OBSERVER)),
      },
      spawnReceiptFile: "/OFFLINE_ONLY/canonical-next-spawn.json",
      spawnReceiptSha256: "6".repeat(64),
      spawnObserverOptInFile: "/OFFLINE_ONLY/opt-in.json",
      spawnObserverOptInSha256: "7".repeat(64),
    });
    const spawn = {
      schema: "lets-assist-canonical-next-spawn-v1",
      materialized: true,
      observedSuccessfulSpawn: true,
      selectedChildEnvironmentMatches: true,
      ...expected,
      uid,
      script: receipt.script,
      node: receipt.node,
      observer: receipt.spawnObserver,
      optInFile: receipt.spawnObserverOptInFile,
      optInSha256: receipt.spawnObserverOptInSha256,
      nextTitleSourceProofSha256: titleProof.sourceProofSha256,
      runner,
      listener,
      spawnCallEpochMs: 4100,
      spawnObservedEpochMs: 4150,
      createdAtEpochMs: 4200,
      spawnOptions: {
        cwd: REPO,
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      },
    };
    const guard = (r, e, o) => runtimeBindingGuard(r, e, o, spawn, titleProof);
    const observed = {
      runner: { ...runner, executableMatches: true, argvMatches: true },
      listener: { ...listener, executableMatches: true, titleMatches: true },
      listenerParentPid: runner.pid,
      listenerDescendsFromRunner: true,
      selectedEnvironmentMatches: true,
    };
    allow("runtime", () => bindingShapeGuard(receipt, expected));
    allow("runtime", () => guard(receipt, expected, observed));
    const literalChunk = structuredClone(receipt);
    literalChunk.servedArtifacts[1] = {
      relativeBuildFile: nextPaths[5],
      urlPath: `/_next/${nextPaths[5]}`,
      sha256: hashes[nextPaths[5]],
    };
    allow("runtime", () => bindingShapeGuard(literalChunk, expected));
    // Declared paths are checked before joining; normalization must never adopt
    // sibling, absolute, empty/dot or encoded traversal entries from receipts.
    for (const name of [
      "",
      "/server/app/projects/[id]/page.js",
      "../sibling/server.js",
      "server/../worker.js",
      "server/./worker.js",
      "server//worker.js",
      "server/worker.js/",
      "C:/server/worker.js",
      "C:server/worker.js",
      "server\\worker.js",
      "server/worker\u0000.js",
      "server/worker\u0001.js",
      "server/worker\n.js",
      "server/worker\u007f.js",
      "server/%2e%2e/worker.js",
      "server/worker?file.js",
      "server/worker#file.js",
    ]) {
      const badHashes = { ...hashes, [name]: "0".repeat(64) };
      deny("runtime", () =>
        bindingShapeGuard(
          { ...receipt, compiledFileHashes: badHashes },
          expected,
        ),
      );
      deny("runtime", () => exactCompiledFiles(build, badHashes));
    }
    for (const name of [
      "static/chunks/app/(landing)/page-offline.js.map",
      "static/chunks/app/(landing)/page-offline.json",
      "static/chunks/app/(landing)/page-offline.js/../page.js",
      "static/chunks/app/@modal/../../page.js",
    ]) {
      const bad = structuredClone(receipt);
      bad.compiledFileHashes[name] = "0".repeat(64);
      bad.servedArtifacts[1] = {
        relativeBuildFile: name,
        urlPath: `/_next/${name}`,
        sha256: "0".repeat(64),
      };
      deny("runtime", () => bindingShapeGuard(bad, expected));
    }
    // Pure fictional snapshots are test controls only, never live proof.
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
      deny("runtime", () =>
        guard(
          { ...receipt, [key]: key.endsWith("Port") ? 12345 : "different" },
          expected,
          observed,
        ),
      );
    for (const change of [
      { materialized: false },
      { fromCanonicalLaunch: false },
      { sourceClean: false },
      { buildFinalized: false },
      { buildDistDir: ".next" },
      { startMode: "dev" },
      { portWasVacant: false },
      { buildCompletedAtEpochMs: 4500 },
      { portClaimedAtEpochMs: 4500 },
      { createdAtEpochMs: 3000 },
      {
        script: {
          path: "/OFFLINE_ONLY/run-dvhs-csf-isolated-app.mjs",
          sha256: "4".repeat(64),
        },
      },
      {
        compiledFileHashes: Object.fromEntries(
          BUILD_ARTIFACTS.map((f) => [f, hashes[f]]),
        ),
      },
      { servedArtifacts: [] },
      { uid: uid + 1 },
    ])
      deny("runtime", () =>
        guard({ ...receipt, ...change }, expected, observed),
      );
    for (const role of ["runner", "listener"])
      for (const change of [
        { pid: 42 },
        { cwd: "/wrong" },
        { uid: uid + 1 },
        { startIdentity: "STALE" },
        { startedAtEpochMs: 9000 },
        { executableMatches: false },
        { [role === "runner" ? "argvMatches" : "titleMatches"]: false },
      ])
        deny("runtime", () =>
          guard(receipt, expected, {
            ...observed,
            [role]: { ...observed[role], ...change },
          }),
        );
    for (const change of [
      { listenerDescendsFromRunner: false },
      { listenerParentPid: runner.pid + 2 },
      { selectedEnvironmentMatches: false },
    ])
      deny("runtime", () =>
        guard(receipt, expected, { ...observed, ...change }),
      );
    const wrongArgv = structuredClone(receipt);
    wrongArgv.listener.argv[2] = "dev";
    deny("runtime", () => bindingShapeGuard(wrongArgv, expected));
    const falseNode = structuredClone(receipt);
    falseNode.runner.argv[0] = "/other/node";
    deny("runtime", () => bindingShapeGuard(falseNode, expected));
    for (const change of [
      { relativeBuildFile: "static/other-build/_buildManifest.js" },
      { urlPath: "https://lets-assist.com/_next/a.js" },
      { sha256: "0".repeat(64) },
      { relativeBuildFile: "static/../server/worker.js" },
    ]) {
      const bad = structuredClone(receipt);
      Object.assign(bad.servedArtifacts[0], change);
      deny("runtime", () => bindingShapeGuard(bad, expected));
    }
    // Exact known title remains insufficient without the actual spawn proof.
    deny("runtime", () =>
      runtimeBindingGuard(receipt, expected, observed, null, titleProof),
    );
    for (const change of [
      { materialized: false },
      { observedSuccessfulSpawn: false },
      { selectedChildEnvironmentMatches: false },
      { spawnCallEpochMs: 1000 },
      { spawnObservedEpochMs: 3000 },
      { createdAtEpochMs: 3000 },
      { optInSha256: "0".repeat(64) },
      { nextTitleSourceProofSha256: "0".repeat(64) },
      { observer: { path: "/OTHER/observer.cjs", sha256: "0".repeat(64) } },
    ])
      deny("runtime", () =>
        runtimeBindingGuard(
          receipt,
          expected,
          observed,
          { ...spawn, ...change },
          titleProof,
        ),
      );
    for (const role of ["runner", "listener"])
      for (const change of [
        { pid: 42 },
        { startIdentity: "STALE" },
        { cwd: "/other" },
        { argv: [node, "/OTHER/script"] },
      ])
        deny("runtime", () =>
          spawnBindingGuard(
            { ...spawn, [role]: { ...spawn[role], ...change } },
            receipt,
            titleProof,
          ),
        );
    for (const title of [
      "next-server",
      "next-server (v16.4.0) extra",
      "evil next-server (v16.4.0)",
      "next-server (v16.5.0)",
    ])
      deny("runtime", () =>
        guard({ ...receipt, listenerTitle: title }, expected, observed),
      );
    const sameSecond = structuredClone(receipt);
    sameSecond.buildCompletedAtEpochMs = 4050;
    allow("runtime", () =>
      runtimeBindingGuard(sameSecond, expected, observed, spawn, titleProof),
    );
    const childEnv = {
      NODE_ENV: "production",
      NEXT_DIST_DIR: BUILD_DIST_DIR,
      CSF_LOCAL_FIXTURE_MODE: "1",
      PORT: "3057",
      CSF_ISOLATED_WORK_DIR: expected.workDir,
      NEXT_PUBLIC_SUPABASE_URL: api,
      NODE_OPTIONS: `--require ${path.join(REPO, "scripts/local-dev/cron-egress-guard.cjs")}`,
      DB_URL: "postgres://OFFLINE_ONLY@127.0.0.1:55082/postgres",
      SUPABASE_DB_URL: "postgres://OFFLINE_ONLY@127.0.0.1:55082/postgres",
    };
    const options = {
        cwd: REPO,
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
        env: childEnv,
      },
      opt = { ...expected, node: { path: node } },
      args = listener.argv.slice(1);
    allow("runtime", () =>
      assert.equal(exactSpawnCall(node, args, options, opt), true),
    );
    for (const change of [
      { cwd: "/other" },
      { detached: false },
      { stdio: "inherit" },
      { env: { ...childEnv, NODE_ENV: "development" } },
      { env: { ...childEnv, NODE_OPTIONS: "--require /other/observer.cjs" } },
      {
        env: {
          ...childEnv,
          NEXT_PUBLIC_SUPABASE_URL: "https://real.example.test",
        },
      },
      {
        env: {
          ...childEnv,
          DB_URL: "postgres://OFFLINE_ONLY@remote.test:55082/postgres",
        },
      },
    ])
      allow("runtime", () =>
        assert.equal(
          exactSpawnCall(node, args, { ...options, ...change }, opt),
          false,
        ),
      );
    for (const badArgs of [
      [...args.slice(0, 1), "dev", ...args.slice(2)],
      [...args, "--extra"],
      args.map((a) => (a === "127.0.0.1" ? "0.0.0.0" : a)),
    ])
      allow("runtime", () =>
        assert.equal(exactSpawnCall(node, badArgs, options, opt), false),
      );
    const disabled = path.join(tmp, "runtime.disabled.json");
    fs.writeFileSync(
      disabled,
      JSON.stringify({ ...receipt, materialized: false }),
      { mode: 0o600 },
    );
    deny("runtime", () =>
      readRuntimeBinding(disabled, digest(fs.readFileSync(disabled))),
    );
    deny("runtime", () => readRuntimeBinding(disabled, "0".repeat(64)));
    fs.symlinkSync(disabled, path.join(tmp, "runtime-link.json"));
    deny("runtime", () =>
      readRuntimeBinding(
        path.join(tmp, "runtime-link.json"),
        digest(fs.readFileSync(disabled)),
      ),
    );
    const stale = path.join(tmp, "runtime.stale.json");
    fs.writeFileSync(
      stale,
      JSON.stringify({
        ...receipt,
        buildCompletedAtEpochMs: Date.now() + 60000,
        createdAtEpochMs: Date.now() + 61000,
      }),
      { mode: 0o600 },
    );
    deny("runtime", () =>
      readRuntimeBinding(stale, digest(fs.readFileSync(stale))),
    );

    // New empty canonical Git-ignored directory, no arbitrary /.artifacts/ path.
    execFileSync("/usr/bin/git", ["init", "--quiet"], {
      cwd: tmp,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".artifacts/\n");
    const output = path.join(tmp, ".artifacts/layout-audit/new-only");
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    allow("output", () => newCaptureOutput(tmp, output));
    const journalPath = path.join(output, "capture-results.jsonl");
    const journal = createExclusiveReceipt(journalPath);
    appendDurableReceipt(journal, { offline: true });
    fs.closeSync(journal);
    const before = fs.readFileSync(journalPath);
    deny("output", () => createExclusiveReceipt(journalPath));
    allow("output", () =>
      assert.deepEqual(fs.readFileSync(journalPath), before),
    );
    deny("output", () => newCaptureOutput(tmp, output));
    const result = path.join(output, "capture-results.json");
    const fd = createExclusiveReceipt(result);
    appendDurableReceipt(fd, { original: true });
    fs.closeSync(fd);
    const original = fs.readFileSync(result);
    deny("output", () => createExclusiveReceipt(result));
    allow("output", () => assert.deepEqual(fs.readFileSync(result), original));
    fs.symlinkSync(result, path.join(output, "symlink-result.json"));
    deny("output", () =>
      createExclusiveReceipt(path.join(output, "symlink-result.json")),
    );
    allow("output", () => assert.deepEqual(fs.readFileSync(result), original));
    const outside = path.join(tmp, ".artifacts/other");
    fs.mkdirSync(outside, { mode: 0o700 });
    deny("output", () => newCaptureOutput(tmp, outside));
    const ignored = path.join(tmp, ".artifacts/layout-audit/not-ignored");
    fs.mkdirSync(ignored, { mode: 0o700 });
    fs.writeFileSync(path.join(tmp, ".gitignore"), "");
    deny("output", () => newCaptureOutput(tmp, ignored));
    fs.writeFileSync(path.join(tmp, ".gitignore"), ".artifacts/\n");
    const wide = path.join(tmp, ".artifacts/layout-audit/wide");
    fs.mkdirSync(wide, { mode: 0o755 });
    deny("output", () => newCaptureOutput(tmp, wide));
    fs.symlinkSync(ignored, path.join(tmp, ".artifacts/layout-audit/link"));
    deny("output", () =>
      newCaptureOutput(tmp, path.join(tmp, ".artifacts/layout-audit/link")),
    );
    const pngDir = path.join(tmp, ".artifacts/layout-audit/png-existing");
    fs.mkdirSync(pngDir, { mode: 0o700 });
    fs.writeFileSync(path.join(pngDir, "old.png"), "PREVIOUS PNG");
    deny("output", () => newCaptureOutput(tmp, pngDir));
    allow("output", () =>
      assert.equal(
        fs.readFileSync(path.join(pngDir, "old.png"), "utf8"),
        "PREVIOUS PNG",
      ),
    );
    allow("output", () =>
      assert.equal(
        fs.existsSync(path.join(pngDir, "capture-results.json")),
        false,
      ),
    );
    allow("output", () =>
      validateCaptureNames([
        { id: "landing-baseline" },
        { id: "csf-my-profile" },
      ]),
    );
    for (const id of [
      "/absolute",
      "../escape",
      "a/b",
      "a\\b",
      ".",
      "..",
      "a/../b",
      "a\u0000b",
      "a ".repeat(3),
      "A-capital",
      "x".repeat(91),
      null,
    ])
      deny("output", () => validateCaptureNames([{ id }]));
    deny("output", () =>
      validateCaptureNames([{ id: "duplicate" }, { id: "duplicate" }]),
    );
    deny("output", () => validateCaptureNames([]));
    deny("output", () => validateCaptureNames([null]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return {
    checks,
    categories,
    liveRuntimeProved: false,
    networkStarted: false,
    browserStarted: false,
    sourceEdited: false,
  };
}
