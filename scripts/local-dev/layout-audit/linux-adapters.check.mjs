// Offline only: owned temporary files and fictional parser/event/row inputs.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  os = require("./linux-platform.cjs"),
  binding = require("./linux-binding.cjs");
const dir = fs.realpathSync(new URL(".", import.meta.url).pathname);
const root = fs.realpathSync(process.env.GITHUB_WORKSPACE ?? process.cwd());
require("./linux-check-stage.cjs").requireOwnedCheckStage(root, dir);
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(dir, ".offline-linux-"))),
  old = path.join(dir, "upstream");
let checks = 0;
const pass = (fn) => {
    fn();
    checks++;
  },
  deny = (fn) => {
    assert.throws(fn);
    checks++;
  };
const boot = "11111111-1111-4111-8111-111111111111",
  uid = process.getuid(),
  proofNames = [
    "static-image-source-proof.json",
    "next-title-source-proof.json",
    "runtime-cache-source-proof.json",
    "read-action-source-review.json",
    "private-next-title-source-proof.json",
  ];
const cfg = {
  schema: "lets-assist-layout-linux-binding-v1",
  template: true,
  materialized: false,
  testOnly: true,
  repoRoot: root,
  rootHead: "1".repeat(40),
  privateHead: "38dc7c7aff6fd101c87f92eebfae822d1726f2b4",
  ledgerCount: 723,
  codeManifestSha256: "2".repeat(64),
  dirtyDiffSha256: os.hash(Buffer.from("\n--private--\n")),
  capturePaths: ["/"],
  reviewedSourceHashes: {},
  uid,
  runId: "ci00000000000000",
  projectId: "lets-assist-csf-browser-ci00000000000000",
  workDir: "/tmp/lets-assist-csf-browser-ci00000000000000",
  appPort: 3000,
  privateAppPort: 3001,
  apiPort: 25321,
  databasePort: 25322,
  databaseVolume: "OFFLINE_ONLY",
  node: { path: "/OFFLINE_ONLY/node", sha256: "3".repeat(64) },
  script: {
    path: path.join(root, "scripts/local-dev/run-dvhs-csf-isolated-app.mjs"),
    sha256: "4".repeat(64),
  },
  captureTemplateFile: path.join(old, "manifest.baseline-template.json"),
  captureTemplateSha256: os.hash(
    fs.readFileSync(path.join(old, "manifest.baseline-template.json")),
  ),
  proofHashes: Object.fromEntries(proofNames.map((n) => [n, "5".repeat(64)])),
};
try {
  const configFile = path.join(tmp, "binding.json");
  fs.writeFileSync(configFile, JSON.stringify(cfg), { mode: 0o600 });
  process.env.LETS_ASSIST_LAYOUT_BINDING = configFile;
  delete process.env.LETS_ASSIST_LAYOUT_SPAWN_OBSERVER_OPT_IN;
  pass(() => binding.shape(cfg));
  for (const key of Object.keys(cfg)) {
    const c = structuredClone(cfg);
    delete c[key];
    deny(() => binding.shape(c));
  }
  deny(() => binding.live(binding.load()));
  const fields = Array.from({ length: 30 }, () => "0");
  fields[0] = "S";
  fields[1] = "9001";
  fields[19] = "123456";
  const stat = "9002 (fictional process ) name) " + fields.join(" ");
  pass(() =>
    assert.deepEqual(os.parseStat(stat, 9002), {
      pid: 9002,
      parentPid: 9001,
      startTicks: "123456",
    }),
  );
  deny(() => os.parseStat(stat, 9003));
  deny(() => os.parseStat(stat.replace("123456", "not-ticks"), 9002));
  deny(() => os.parseStat("broken", 9002));
  pass(() => os.parseStatus(`Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`, uid));
  deny(() => os.parseStatus(`Uid:\t${uid + 1}\t${uid}\t${uid}\t${uid}\n`, uid));
  deny(() =>
    os.parseStatus(
      `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`,
      uid,
    ),
  );
  const env = Buffer.from(
    "NODE_OPTIONS=--require /fictional/guard.cjs\0SECRET=OFFLINE_ONLY\0PORT=3000\0",
  );
  pass(() =>
    assert.deepEqual(os.selectedEnv(env, ["NODE_OPTIONS", "PORT"]), {
      NODE_OPTIONS: "--require /fictional/guard.cjs",
      PORT: "3000",
    }),
  );
  deny(() => os.selectedEnv(Buffer.from("PORT=3000\0PORT=3001\0"), ["PORT"]));
  deny(() => os.nulVector(Buffer.from("no-terminator")));
  const tcp =
    " sl local_address rem_address st tx_queue tr retr uid timeout inode\n 0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 " +
    uid +
    " 0 42 1\n";
  const rows = os.tcpRows(tcp, 3000);
  pass(() => assert.equal(os.verifiedSocket(rows, uid, ["socket:[42]"]), "42"));
  for (const r of [
    [...rows, ...rows],
    [{ ...rows[0], host: "00000000" }],
    [{ ...rows[0], uid: uid + 1 }],
    [],
  ])
    deny(() => os.verifiedSocket(r, uid, ["socket:[42]"]));
  deny(() => os.verifiedSocket(rows, uid, ["socket:[43]"]));
  const r = path.join(tmp, "receipt.json");
  os.exclusiveJSON(r, { schema: "OFFLINE ONLY", materialized: false });
  const sha = os.hash(fs.readFileSync(r));
  pass(() => assert.equal(os.readCreatedJSON(r, sha).materialized, false));
  deny(() => os.exclusiveJSON(r, {}));
  deny(() => os.readCreatedJSON(r, "0".repeat(64)));
  const copy = path.join(tmp, "copied.json");
  fs.copyFileSync(r, copy);
  fs.chmodSync(copy, 0o600);
  deny(() => os.readCreatedJSON(copy, os.hash(fs.readFileSync(copy))));
  const symlink = path.join(tmp, "link.json");
  fs.symlinkSync(r, symlink);
  deny(() => os.readCreatedJSON(symlink, sha));
  deny(() => os.exclusiveJSON(symlink, {}));
  const created = JSON.parse(fs.readFileSync(r));
  for (const change of [
    { creationProof: null },
    { creationProof: { ...created.creationProof, uid: uid + 1 } },
    {
      creationProof: {
        ...created.creationProof,
        ino: created.creationProof.ino + 1,
      },
    },
    { createdAtEpochMs: Date.now() + 60000 },
  ]) {
    fs.writeFileSync(r, JSON.stringify({ ...created, ...change }));
    deny(() => os.readCreatedJSON(r));
  }
  fs.writeFileSync(r, JSON.stringify(created));
  const bd = path.join(tmp, "dist");
  for (const n of [
    "server/app/[id]/page.js",
    "server/app/(group)/@modal/page.js",
    "static/chunks/a.js",
    "BUILD_ID",
  ]) {
    fs.mkdirSync(path.dirname(path.join(bd, n)), { recursive: true });
    fs.writeFileSync(path.join(bd, n), "OFFLINE COMPILED " + n);
  }
  const frozen = os.freezeFiles(bd);
  pass(() => assert(frozen["server/app/[id]/page.js"]));
  fs.writeFileSync(path.join(bd, "server/app/[id]/page.js"), "DRIFT");
  pass(() => assert.notDeepEqual(os.freezeFiles(bd), frozen));
  fs.symlinkSync(r, path.join(bd, "server/app/foreign.js"));
  deny(() => os.freezeFiles(bd));
  fs.unlinkSync(path.join(bd, "server/app/foreign.js"));
  for (const n of [
    "../a",
    "/a",
    "a//b",
    "a/./b",
    "a/../b",
    "a/",
    "C:/a",
    "a\\b",
    "a\0b",
    "a%2eb",
  ])
    pass(() => assert.equal(os.safeRelative(n), false));
  const id = (pid, ppid, cwd, ticks, epoch) => ({
    pid,
    parentPid: ppid,
    uid,
    cwd,
    executable: cfg.node.path,
    bootId: boot,
    startTicks: String(ticks),
    startIdentity: boot + ":" + pid + ":" + ticks,
    startedAtEpochMs: epoch,
    startClockPrecisionMs: 1000,
  });
  const b = {
      ...cfg,
      bindingFile: configFile,
      bindingSha256: os.hash(fs.readFileSync(configFile)),
    },
    runner = {
      ...id(9001, 8999, root, 1000, 1000),
      argv: [cfg.node.path, cfg.script.path],
    },
    hashes = Object.fromEntries(
      [
        "BUILD_ID",
        "build-manifest.json",
        "routes-manifest.json",
        "required-server-files.json",
        "server/app-paths-manifest.json",
        "server/app/[id]/page.js",
        "static/offline/_buildManifest.js",
        "static/chunks/a.js",
      ].map((n) => [n, "6".repeat(64)]),
    );
  const common = {
    ...Object.fromEntries(
      [
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
      ].map((k) => [k, b[k]]),
    ),
    node: b.node,
    script: b.script,
    runner,
  };
  const build = {
    schema: "lets-assist-linux-canonical-build-v1",
    materialized: true,
    observedBuildSuccess: true,
    observedBuildChild: true,
    portWasVacant: true,
    role: "platform",
    ...common,
    claim: { pid: runner.pid, uid, mode: 0o600, dev: 1, ino: 2 },
    claimObservedAtEpochMs: 2000,
    buildCallEpochMs: 2100,
    buildCompletedAtEpochMs: 3000,
    artifactFrozenAtEpochMs: 3500,
    createdAtEpochMs: 3501,
    buildDirectory: path.join(root, ".next-csf-isolated/browser-app"),
    buildId: "offline",
    compiledFileHashes: hashes,
    argv: [
      cfg.node.path,
      path.join(root, "node_modules/next/dist/bin/next"),
      "build",
      "--webpack",
    ],
    buildChild: id(9002, 9001, root, 2000, 2200),
    exitCode: 0,
    exitSignal: null,
  };
  const spawn = {
    schema: "lets-assist-canonical-next-spawn-v1",
    materialized: true,
    observedSuccessfulSpawn: true,
    selectedChildEnvironmentMatches: true,
    role: "platform",
    ...common,
    listener: {
      ...id(9003, 9001, root, 4000, 4000),
      argv: [
        cfg.node.path,
        path.join(root, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3000",
      ],
    },
    spawnOptions: {
      cwd: root,
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    },
    spawnCallEpochMs: 4100,
    spawnObservedEpochMs: 4150,
    createdAtEpochMs: 4200,
  };
  const contract = await import("./linux-proof-contract.mjs");
  pass(() => contract.validateBuild(build, b, "platform"));
  pass(() => contract.validateSpawn(spawn, b, build, "platform"));
  for (const k of Object.keys(build)) {
    const x = structuredClone(build);
    delete x[k];
    deny(() => contract.validateBuild(x, b, "platform"));
  }
  for (const k of [
    "observedSuccessfulSpawn",
    "selectedChildEnvironmentMatches",
    "role",
    "listener",
    "spawnCallEpochMs",
    "spawnObservedEpochMs",
    "spawnOptions",
    "codeManifestSha256",
    "bindingFile",
  ]) {
    const x = structuredClone(spawn);
    delete x[k];
    deny(() => contract.validateSpawn(x, b, build, "platform"));
  }
  for (const change of [
    { exitCode: 1 },
    { exitSignal: "SIGTERM" },
    { observedBuildSuccess: false },
    { artifactFrozenAtEpochMs: 2000 },
    { compiledFileHashes: { BUILD_ID: "6".repeat(64) } },
    { buildChild: { ...build.buildChild, parentPid: 9999 } },
  ])
    deny(() => contract.validateBuild({ ...build, ...change }, b, "platform"));
  for (const change of [
    { listener: { ...spawn.listener, parentPid: 9999 } },
    { listener: { ...spawn.listener, startIdentity: "spoofed" } },
    { spawnCallEpochMs: 2500 },
    { spawnObservedEpochMs: 4000 },
    {
      spawnOptions: {
        cwd: root,
        detached: false,
        stdio: ["ignore", "inherit", "inherit"],
      },
    },
  ])
    deny(() =>
      contract.validateSpawn({ ...spawn, ...change }, b, build, "platform"),
    );
  const observer = require("./linux-spawn-observer.cjs"),
    args = spawn.listener.argv.slice(1),
    options = {
      cwd: root,
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        NEXT_DIST_DIR: ".next-csf-isolated/browser-app",
        CSF_LOCAL_FIXTURE_MODE: "1",
        CSF_ISOLATED_WORK_DIR: b.workDir,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:25321",
        NODE_OPTIONS: `--require ${root}/scripts/local-dev/cron-egress-guard.cjs`,
        DB_URL: "postgres://OFFLINE_ONLY@127.0.0.1:25322/postgres",
        SUPABASE_DB_URL: "postgres://OFFLINE_ONLY@127.0.0.1:25322/postgres",
      },
    };
  // Exercise the same generated opt-in builder used by prepare-observer.
  const optIn = observer.makeObserverOptIn(
    {
      ...b,
      creationProof: { offline: true },
      enabled: false,
      allowRuntimeObservation: false,
    },
    { path: "/OFFLINE_ONLY/observer.cjs", sha256: "7".repeat(64) },
    path.join(tmp, "observer"),
  );
  pass(() =>
    assert.equal(
      optIn.schema,
      "lets-assist-canonical-spawn-observer-opt-in-v1",
    ),
  );
  pass(() =>
    assert.deepEqual(
      [optIn.template, optIn.enabled, optIn.allowRuntimeObservation],
      [false, true, true],
    ),
  );
  pass(() => assert.equal(Object.hasOwn(optIn, "creationProof"), false));
  pass(() => {
    for (const key of [
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
    ])
      assert.equal(optIn[key], b[key]);
    assert.deepEqual(optIn.observer, {
      path: "/OFFLINE_ONLY/observer.cjs",
      sha256: "7".repeat(64),
    });
    assert.equal(optIn.outputDir, path.join(tmp, "observer"));
  });
  pass(() => {
    const f = path.join(tmp, "generated-opt-in.json");
    os.exclusiveJSON(f, optIn);
    const read = os.readCreatedJSON(f);
    assert.equal(read.schema, "lets-assist-canonical-spawn-observer-opt-in-v1");
    assert.equal(read.bindingSha256, b.bindingSha256);
    assert.equal(read.enabled, true);
  });
  pass(() => assert(observer.exactSpawnCall(cfg.node.path, args, options, b)));
  for (const change of [
    { detached: false },
    { cwd: "/wrong" },
    { env: { ...options.env, NODE_ENV: "development" } },
    { env: { ...options.env, NODE_OPTIONS: "--require /unknown" } },
    {
      env: {
        ...options.env,
        DB_URL: "postgres://OFFLINE_ONLY@remote.test:25322/postgres",
      },
    },
  ])
    pass(() =>
      assert.equal(
        observer.exactSpawnCall(
          cfg.node.path,
          args,
          { ...options, ...change },
          b,
        ),
        false,
      ),
    );
  const child = { fictional: true },
    context = {};
  let originalCalls = 0;
  const original = function (c, a, o) {
    originalCalls++;
    assert.equal(this, context);
    assert.equal(c, cfg.node.path);
    assert.equal(a, args);
    assert.equal(o, options);
    return child;
  };
  pass(() =>
    assert.equal(
      observer.passthroughSpawn(original, context, [
        cfg.node.path,
        args,
        options,
      ]),
      child,
    ),
  );
  pass(() => assert.equal(originalCalls, 1));
  const fixture = await import("./collect-fixture-proof.mjs"),
    seed = await import(
      path.join(root, "scripts/local-dev/seed-platform-fixtures.mjs")
    ),
    accounts = seed.buildSeedFixtureSets(true).seededAccounts,
    users = accounts.map((a, i) => ({
      id: `b1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      email: a.email,
      role: "authenticated",
      aud: "authenticated",
      phone: null,
      user_metadata: {
        local_fixture: true,
        full_name: a.fullName,
        username: a.email.split("@")[0].replaceAll(".", "-"),
        avatar_url: a.avatarUrl ?? null,
      },
      app_metadata: {
        provider: "email",
        providers: ["email"],
        ...(a.superAdmin
          ? { role: "super_admin", is_super_admin: true, local_fixture: true }
          : {}),
      },
    })),
    profiles = users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.user_metadata.username,
      full_name: u.user_metadata.full_name,
      avatar_url: u.user_metadata.avatar_url,
      phone: null,
    })),
    projects = [
      {
        id: seed.IDS.publicProject,
        creator_id: users[accounts.findIndex((a) => a.key === "csfAdmin")].id,
      },
      { id: seed.IDS.orgProject, creator_id: users[0].id },
    ],
    input = { binding: b, accounts, users, profiles, projects, ids: seed.IDS };
  pass(() =>
    assert.equal(fixture.fixtureProofFromRows(input).baselineActors.length, 22),
  );
  for (const mutation of [
    (v) => v.users.pop(),
    (v) => v.users.push(v.users[0]),
    (v) => (v.users[1].app_metadata.role = "super_admin"),
    (v) => (v.profiles[0].phone = "REAL_PHONE_REFUSED"),
    (v) => delete v.users[0].user_metadata.local_fixture,
    (v) => (v.projects[0].creator_id = v.users[1].id),
    (v) => (v.users[0].email = "unknown@local.test"),
    (v) => delete v.profiles[0].phone,
  ]) {
    const x = structuredClone(input);
    mutation(x);
    deny(() => fixture.fixtureProofFromRows(x));
  }
  // Count/key diagnostics never serialize caller identities or arbitrary source keys.
  const diagnostic = fixture.fixtureCorpusDiagnostics({
    ...input,
    observations: {
      profileReportedTotal: 22,
      authPages: [{ page: 1, rowCount: 22, reportedTotal: 22, nextPage: null }],
    },
  });
  pass(() =>
    assert.deepEqual(
      [
        diagnostic.sourceActorCount,
        diagnostic.observedAuthCount,
        diagnostic.observedProfileCount,
        diagnostic.unknownAuthCount,
        diagnostic.unknownProfileObservedCount,
      ],
      [22, 22, 22, 0, 0],
    ),
  );
  pass(() => {
    const x = structuredClone(input);
    x.users.pop();
    x.profiles.pop();
    const d = fixture.fixtureCorpusDiagnostics(x);
    assert.deepEqual(d.missingAuthActorKeys, [accounts.at(-1).key]);
    assert.deepEqual(d.missingProfileActorKeys, [accounts.at(-1).key]);
  });
  pass(() => {
    const x = structuredClone(input);
    x.users.push({
      id: "PRIVATE_UUID_SENTINEL",
      email: "PRIVATE_EMAIL_SENTINEL",
      full_name: "PRIVATE_NAME_SENTINEL",
    });
    x.profiles.push({
      id: "PRIVATE_UUID_SENTINEL",
      email: "PRIVATE_EMAIL_SENTINEL",
      full_name: "PRIVATE_NAME_SENTINEL",
    });
    const d = fixture.fixtureCorpusDiagnostics(x);
    assert.equal(d.unknownAuthCount, 1);
    assert.equal(d.unknownProfileObservedCount, 1);
    assert(!JSON.stringify(d).includes("PRIVATE_"));
    assert.throws(
      () => fixture.fixtureProofFromRows(x),
      (error) =>
        !error.message.includes("PRIVATE_") &&
        error.message.includes('"unknownAuthCount":1'),
    );
  });
  pass(() => {
    const x = structuredClone(input);
    x.accounts[0].key = "PRIVATE_NAME_SENTINEL";
    const d = fixture.fixtureCorpusDiagnostics(x);
    assert.equal(d.unknownSourceActorCount, 1);
    assert(!JSON.stringify(d).includes("PRIVATE_"));
  });
  pass(() => {
    const d = fixture.fixtureCorpusDiagnostics({
      ...input,
      profiles: null,
      observations: {
        profileReportedTotal: "PRIVATE_SECRET_SENTINEL",
        authPages: [
          {
            page: 1,
            rowCount: 20,
            reportedTotal: 22,
            nextPage: 2,
            url: "PRIVATE_SECRET_SENTINEL",
          },
        ],
      },
    });
    assert.equal(d.observedProfileCount, null);
    assert.equal(d.profileReportedTotal, null);
    assert.deepEqual(d.authPages, [
      { page: 1, rowCount: 20, reportedTotal: 22, nextPage: 2 },
    ]);
    assert(!JSON.stringify(d).includes("PRIVATE_"));
  });
  pass(() => {
    const x = structuredClone(input);
    x.profiles.push({
      id: "PRIVATE_UUID_SENTINEL",
      email: "PRIVATE_EMAIL_SENTINEL",
    });
    assert.throws(
      () => fixture.fixtureProofFromRows(x),
      (error) =>
        error.message.includes('"observedAuthCount":22') &&
        error.message.includes('"observedProfileCount":23') &&
        error.message.includes('"unknownProfileObservedCount":1') &&
        !error.message.includes("PRIVATE_"),
    );
  });
  pass(() => {
    const x = structuredClone(input);
    x.users.splice(-2);
    const d = fixture.fixtureCorpusDiagnostics(x);
    assert.equal(d.observedAuthCount, 20);
    assert.deepEqual(
      d.missingAuthActorKeys,
      accounts.slice(-2).map((a) => a.key),
    );
    assert.equal(d.unknownAuthCount, 0);
  });
  // These literal/dynamic owners are grounded in real source page files.
  pass(() => {
    for (const file of [
      "app/projects/[id]/page.tsx",
      "app/projects/create/page.tsx",
      "app/projects/drafts/page.tsx",
      "app/organization/[id]/page.tsx",
      "app/organization/create/page.tsx",
    ]) {
      const f = path.join(root, file),
        st = fs.lstatSync(f);
      assert(st.isFile() && !st.isSymbolicLink() && st.uid === uid);
      assert.equal(fs.realpathSync(f), f);
    }
  });
  const esmCache = await import("./capture-cache-contract.mjs"),
    cjsCache = require("./observer-cache-policy.cjs");
  const pageOwners = {
    "/projects/[id]/page": "app/projects/[id]/page.js",
    "/projects/create/page": "app/projects/create/page.js",
    "/projects/drafts/page": "app/projects/drafts/page.js",
    "/organization/[id]/page": "app/organization/[id]/page.js",
    "/organization/create/page": "app/organization/create/page.js",
  };
  const mapOwner = (cacheImplementation, owners, selected) =>
    cacheImplementation.cachePolicyFromCompiled(
      owners,
      selected,
      "6".repeat(64),
      "7".repeat(64),
    );
  for (const cacheImplementation of [esmCache, cjsCache]) {
    for (const selected of [
      "/projects/create",
      "/projects/drafts",
      "/organization/create",
    ]) {
      pass(() => {
        const result = mapOwner(cacheImplementation, pageOwners, [selected]);
        assert.equal(
          [...result.routes.values()][0].sourceRoute,
          selected + "/page",
        );
        assert.equal(
          [...result.routes.values()][0].worker,
          "app" + selected + "/page.js",
        );
      });
    }
    pass(() =>
      assert.equal(
        [
          ...mapOwner(cacheImplementation, pageOwners, [
            "/projects/fictional-id",
          ]).routes.values(),
        ][0].sourceRoute,
        "/projects/[id]/page",
      ),
    );
    deny(() =>
      mapOwner(
        cacheImplementation,
        {
          ...pageOwners,
          "/(duplicate)/projects/create/page":
            "app/(duplicate)/projects/create/page.js",
        },
        ["/projects/create"],
      ),
    );
    deny(() =>
      mapOwner(
        cacheImplementation,
        {
          "/projects/[id]/page": "app/projects/[id]/page.js",
          "/(duplicate)/projects/[id]/page":
            "app/(duplicate)/projects/[id]/page.js",
        },
        ["/projects/fictional-id"],
      ),
    );
    for (const worker of [
      42,
      "pages/projects/create.js",
      "app/projects/create/../page.js",
    ]) {
      deny(() =>
        mapOwner(
          cacheImplementation,
          { ...pageOwners, "/projects/create/page": worker },
          ["/projects/create"],
        ),
      );
    }
  }
  pass(() =>
    assert.deepEqual(
      [
        ...mapOwner(esmCache, pageOwners, [
          "/projects/create",
          "/projects/drafts",
        ]).routes,
      ],
      [
        ...mapOwner(cjsCache, pageOwners, [
          "/projects/create",
          "/projects/drafts",
        ]).routes,
      ],
    ),
  );
  // Diagnostic fields contain no raw message/stack/args/env/paths or records.
  const own = path.join(tmp, "owned"),
    safeFrame = {
      stack:
        "Error: PRIVATE_SECRET_SENTINEL\n    at failure (" +
        path.join(own, "linux-platform.cjs") +
        ":87:2)",
    };
  pass(() =>
    assert.deepEqual(
      observer.observerFailureDiagnostic(
        safeFrame,
        "build-cache-route-map",
        "platform",
        own,
      ),
      {
        phase: "build-cache-route-map",
        role: "platform",
        location: { module: "linux-platform.cjs", line: 87 },
        reasonCode: "unknown",
      },
    ),
  );
  pass(() => {
    const d = observer.observerFailureDiagnostic(
      {
        stack:
          "Error: PRIVATE_SECRET_SENTINEL\n    at function (/foreign/linux-platform.cjs:87:2)",
      },
      "PRIVATE_PHASE_SENTINEL",
      "PRIVATE_ROLE_SENTINEL",
      own,
    );
    assert.deepEqual(d, {
      phase: "unknown",
      role: "unknown",
      location: null,
      reasonCode: "unknown",
    });
    assert(!JSON.stringify(d).includes("PRIVATE_"));
  });
  pass(() =>
    assert.equal(
      observer.observerFailureDiagnostic(
        {
          stack:
            "Error\n at function (" +
            path.join(own, "not-approved.cjs") +
            ":87:2)",
        },
        "build-artifact-freeze",
        "private",
        own,
      ).location,
      null,
    ),
  );
  pass(() =>
    assert.equal(
      observer.observerFailureDiagnostic(
        {
          stack:
            "Error\n at function (" +
            path.join(own, "linux-platform.cjs") +
            ":0:2)",
        },
        "build-artifact-freeze",
        "private",
        own,
      ).location,
      null,
    ),
  );
  pass(() => {
    const d = observer.observerFailureDiagnostic(
      {
        get stack() {
          throw Error("PRIVATE_SECRET_SENTINEL");
        },
      },
      "build-receipt",
      "private",
      own,
    );
    assert.deepEqual(d, {
      phase: "build-receipt",
      role: "private",
      location: null,
      reasonCode: "unknown",
    });
  });
  pass(() => {
    const e = {
      message: "Unknown response cache kind/source hash/selected path",
      stack:
        "Error: PRIVATE_SENTINEL\n at fail (" +
        path.join(own, "cache-contract-dependency.cjs") +
        ":18:1)\n at runtimeCacheEntrySafe (" +
        path.join(own, "observer-cache-policy.cjs") +
        ":410:2)",
    };
    assert.deepEqual(
      observer.observerFailureDiagnostic(
        e,
        "build-artifact-freeze",
        "platform",
        own,
      ),
      {
        phase: "build-artifact-freeze",
        role: "platform",
        location: { module: "observer-cache-policy.cjs", line: 410 },
        reasonCode: "CACHE_RESPONSE_NAMESPACE",
      },
    );
  });
  pass(() => {
    const d = observer.observerFailureDiagnostic(
      {
        message: "PRIVATE_SENTINEL",
        stack:
          "Error: PRIVATE_SENTINEL\n at fail (" +
          path.join(own, "cache-contract-dependency.cjs") +
          ":18:1)",
      },
      "build-artifact-freeze",
      "platform",
      own,
    );
    assert.equal(d.reasonCode, "unknown");
    assert.deepEqual(d.location, {
      module: "cache-contract-dependency.cjs",
      line: 18,
    });
    assert(!JSON.stringify(d).includes("PRIVATE_"));
  });
  pass(() =>
    assert.equal(
      observer.observerFailureDiagnostic(
        {
          message:
            "Unknown response cache kind/source hash/selected path PRIVATE_SENTINEL",
        },
        "build-artifact-freeze",
        "platform",
        own,
      ).reasonCode,
      "unknown",
    ),
  );
  pass(() =>
    assert.equal(
      observer.observerFailureDiagnostic(
        { message: "Unexpected response cache metadata refused" },
        "build-artifact-freeze",
        "platform",
        own,
      ).reasonCode,
      "CACHE_RESPONSE_META_SHAPE",
    ),
  );
  checks += (
    await import("./profile-diagnostics.check.mjs")
  ).runProfileDiagnosticChecks(
    await import("./capture-effects-contract.mjs"),
    fs.readFileSync(new URL("./capture.mjs", import.meta.url), "utf8"),
  );
  // Legacy guard suite remains meaningful and unchanged except explicit binding.
  const data = path.join(dir, "proof-data");
  fs.mkdirSync(data, { mode: 0o700 });
  for (const name of proofNames) {
    const source =
      name === "private-next-title-source-proof.json"
        ? "next-title-source-proof.json"
        : name;
    const proof = JSON.parse(fs.readFileSync(path.join(old, source)));
    if (name === "runtime-cache-source-proof.json") {
      const wasmCache = require("./frozen-wasm-cache.cjs");
      proof.files.push({
        repoRelativePath: wasmCache.SOURCE_RELATIVE,
        realpath: fs.realpathSync(path.join(root, wasmCache.SOURCE_RELATIVE)),
        sha256: wasmCache.SOURCE_SHA256,
      });
      proof.immutableEmbeddedWasm = wasmCache.immutableWasmDescriptor();
    }
    if (proof.repoRoot) proof.repoRoot = root;
    if (proof.files)
      for (const entry of proof.files) {
        entry.realpath = fs.realpathSync(
          path.join(root, entry.repoRelativePath),
        );
        entry.sha256 = os.hash(fs.readFileSync(entry.realpath));
      }
    if (proof.routingSourceHashes)
      for (const file of Object.keys(proof.routingSourceHashes))
        proof.routingSourceHashes[file] = os.hash(
          fs.readFileSync(path.join(root, file)),
        );
    if (proof.sourceHashes)
      for (const file of Object.keys(proof.sourceHashes))
        proof.sourceHashes[file] = os.hash(
          fs.readFileSync(path.join(root, file)),
        );
    if (proof.profileReaderSourceHashes)
      for (const file of Object.keys(proof.profileReaderSourceHashes))
        proof.profileReaderSourceHashes[file] = os.hash(
          fs.readFileSync(path.join(root, file)),
        );
    fs.writeFileSync(path.join(data, name), JSON.stringify(proof), {
      mode: 0o600,
    });
  }
  try {
    // The real Next16.4 embedded WASM record remains immutable compiled data.
    const wasmCache = require("./frozen-wasm-cache.cjs"),
      embedded = wasmCache.readPinnedEmbeddedWasm(root),
      cacheImplementations = [
        require("./observer-cache-policy.cjs"),
        await import("./capture-cache-contract.mjs"),
      ],
      record = {
        kind: "FETCH",
        data: {
          headers: { "content-type": "application/octet-stream" },
          body: embedded.body,
          status: 200,
          url: embedded.uri,
        },
        revalidate: 31536000,
        tags: [],
      },
      cacheDir = path.join(tmp, "embedded-wasm-dist"),
      rel = "cache/fetch-cache/" + embedded.key,
      target = path.join(cacheDir, rel),
      cachePolicy = {
        routes: new Map(),
        loopbackOrigins: ["http://127.0.0.1:3057"],
      };
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const writeRecord = (value) => {
      fs.writeFileSync(target, JSON.stringify(value), { mode: 0o600 });
      fs.chmodSync(target, 0o600);
    };
    const violations = [
      (v) => {
        v.data.body = "AGFzbQEAAAA=";
      },
      (v) => {
        v.data.url += "A";
      },
      (v) => {
        v.data.url = "data:text/plain;base64,T0ZGTElORQ==";
      },
      (v) => {
        v.data.url = "https://unowned.invalid/foreign.wasm";
      },
      (v) => {
        v.data.headers["x-extra"] = "OFFLINE ONLY";
      },
      (v) => {
        v.data.headers["content-type"] = "application/wasm";
      },
      (v) => {
        v.data.status = 201;
      },
      (v) => {
        v.revalidate = 30;
      },
      (v) => {
        v.tags = ["OFFLINE ONLY"];
      },
      (v) => {
        delete v.tags;
      },
      (v) => {
        v.data.extra = "OFFLINE ONLY";
      },
      (v) => {
        v.kind = "APP_PAGE";
      },
    ];
    pass(() =>
      assert.equal(
        wasmCache.frozenEmbeddedWasmFetch(record, embedded.key, root),
        true,
      ),
    );
    pass(() =>
      assert.equal(
        wasmCache.frozenEmbeddedWasmFetch(record, "f".repeat(64), root),
        false,
      ),
    );
    for (const cacheImplementation of cacheImplementations) {
      pass(() => cacheImplementation.exactRuntimeCacheSources());
      writeRecord(record);
      pass(() =>
        assert.equal(
          cacheImplementation.runtimeCacheEntrySafe(
            cacheDir,
            rel,
            fs.lstatSync(target),
            cachePolicy,
          ),
          false,
        ),
      );
      const files = os.freezeFiles(cacheDir, (d, r, st) =>
        cacheImplementation.runtimeCacheEntrySafe(d, r, st, cachePolicy),
      );
      pass(() => assert.equal(files[rel], os.hash(fs.readFileSync(target))));
      fs.appendFileSync(target, "\n");
      pass(() =>
        assert.notDeepEqual(
          os.freezeFiles(cacheDir, (d, r, st) =>
            cacheImplementation.runtimeCacheEntrySafe(d, r, st, cachePolicy),
          ),
          files,
        ),
      );
      for (const alter of violations) {
        const changed = structuredClone(record);
        alter(changed);
        writeRecord(changed);
        deny(() =>
          cacheImplementation.runtimeCacheEntrySafe(
            cacheDir,
            rel,
            fs.lstatSync(target),
            cachePolicy,
          ),
        );
      }
      writeRecord(record);
      const wrongKey = "cache/fetch-cache/" + "f".repeat(64),
        wrongFile = path.join(cacheDir, wrongKey);
      fs.copyFileSync(target, wrongFile);
      fs.chmodSync(wrongFile, 0o600);
      deny(() =>
        cacheImplementation.runtimeCacheEntrySafe(
          cacheDir,
          wrongKey,
          fs.lstatSync(wrongFile),
          cachePolicy,
        ),
      );
      deny(() =>
        os.freezeFiles(cacheDir, (d, r, st) =>
          cacheImplementation.runtimeCacheEntrySafe(d, r, st, cachePolicy),
        ),
      );
      fs.unlinkSync(wrongFile);
      fs.chmodSync(target, 0o700);
      deny(() =>
        cacheImplementation.runtimeCacheEntrySafe(
          cacheDir,
          rel,
          fs.lstatSync(target),
          cachePolicy,
        ),
      );
      deny(() =>
        os.freezeFiles(cacheDir, (d, r, st) =>
          cacheImplementation.runtimeCacheEntrySafe(d, r, st, cachePolicy),
        ),
      );
      fs.chmodSync(target, 0o600);
      fs.renameSync(target, target + "-saved");
      fs.symlinkSync(target + "-saved", target);
      deny(() =>
        cacheImplementation.runtimeCacheEntrySafe(
          cacheDir,
          rel,
          fs.lstatSync(target),
          cachePolicy,
        ),
      );
      fs.unlinkSync(target);
      fs.renameSync(target + "-saved", target);
      const loopback = structuredClone(record);
      loopback.data.url = "http://127.0.0.1:3057/rest/v1/site_settings";
      loopback.data.body = "OFFLINE ONLY";
      loopback.tags = ["fixture"];
      loopback.revalidate = 30;
      writeRecord(loopback);
      pass(() =>
        assert.equal(
          cacheImplementation.runtimeCacheEntrySafe(
            cacheDir,
            rel,
            fs.lstatSync(target),
            cachePolicy,
          ),
          true,
        ),
      );
    }
    // Source drift is exercised ONLY in a copied disposable dependency fixture.
    const sourceRepo = path.join(tmp, "copied-wasm-source"),
      sourceFile = path.join(sourceRepo, wasmCache.SOURCE_RELATIVE),
      sourceBytes = fs.readFileSync(path.join(root, wasmCache.SOURCE_RELATIVE));
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(sourceFile, sourceBytes, { mode: 0o600 });
    pass(() =>
      assert.equal(
        wasmCache.frozenEmbeddedWasmFetch(record, embedded.key, sourceRepo),
        true,
      ),
    );
    fs.appendFileSync(sourceFile, "\n// OFFLINE SOURCE DRIFT");
    deny(() =>
      wasmCache.frozenEmbeddedWasmFetch(record, embedded.key, sourceRepo),
    );
    fs.writeFileSync(sourceFile, sourceBytes, { mode: 0o600 });
    const cacheProofFile = path.join(data, "runtime-cache-source-proof.json"),
      cacheProofBytes = fs.readFileSync(cacheProofFile),
      cacheProof = JSON.parse(cacheProofBytes);
    delete cacheProof.immutableEmbeddedWasm;
    fs.writeFileSync(cacheProofFile, JSON.stringify(cacheProof));
    for (const cacheImplementation of cacheImplementations)
      deny(() => cacheImplementation.exactRuntimeCacheSources());
    fs.writeFileSync(cacheProofFile, cacheProofBytes);
    await import("./guard-tests.mjs");
  } finally {
    fs.rmSync(data, { recursive: true });
  }
  process.stdout.write(
    JSON.stringify({
      linuxOfflineChecks: checks,
      legacyGuards: 568,
      actualLinuxObserved: false,
      networkRequests: 0,
      stackStarts: 0,
      fixtureRowsObserved: 0,
      liveReceiptsCreated: 0,
      pixelsInspected: 0,
    }) + "\n",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
