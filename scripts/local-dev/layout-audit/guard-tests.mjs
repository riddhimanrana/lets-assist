import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  REPO,
  BUILD_DIST_DIR,
  BUILD_ARTIFACTS,
  digest,
  routeSafe,
  localRequestSafe,
  exactCompiledBuild,
  baselineContracts,
  hoursContract,
  proofContracts,
  verifyFixtureRows,
} from "./capture-contract.mjs";

import {
  profileReaderUrl,
  profileReaderFrame,
  reviewedSourceHashes,
  readActionPolicyFromCompiled,
  readActionRequest,
  projectRosterReaderRequest,
} from "./capture-effects-contract.mjs";
let checks = 0;
function allow(fn) {
  fn();
  checks++;
}
function deny(fn) {
  assert.throws(fn);
  checks++;
}
const allowed = [
  "/?noRedirect=1",
  "/admin",
  "/organization/local-platform-org?tab=members",
  "/projects/10000000-0000-4000-8000-000000000020/hours",
  "/login",
];
const denied = [
  "https://lets-assist.com",
  "//lets-assist.com",
  "/logout",
  "/anonymous/a/confirm",
  "/anonymous/a",
  "/attend/a/prepare",
  "/organization/join?code=foo",
  "/organization/join/invite",
  "/guardian-action/x",
  "/api/cron/auto-publish-hours",
  "/feedback/fixture?token=sensitive",
  "/reset-password/private-fixture",
  "/login?challenge=x",
  "/%6cogout",
  "/organization/%6aoin",
  "/%256cogout",
  "/auth/callback",
  "/auth/confirm",
  "/api/google/oauth/connect",
  "/api/calendar/google/connect",
  "/api/dev/reset-preview",
  "/api/admin/moderation/scan-stream",
  "/api/account/data-export/download",
  "/rest/v1/rpc/business_action",
];
for (const route of allowed) allow(() => routeSafe(route));
for (const route of denied) deny(() => routeSafe(route));
const app = "http://127.0.0.1:3057",
  db = "http://127.0.0.1:55081";
for (const url of [
  `${app}/_next/static/a.js`,
  `${db}/rest/v1/profiles?select=id`,
  `${app}/_next/image?url=%2Fdemo%2Favatars%2Fpriya-shah.png&w=256&q=75`,
])
  allow(() => localRequestSafe(url, app, db));
for (const url of [
  "https://lets-assist.com/a",
  "http://127.0.0.1:3058/a",
  `${app}/_next/image?url=https%3A%2F%2Fremote.test%2Fa.png`,
  `${app}/_next/image?url=%2F%2Fremote.test%2Fa.png`,
  `${app}/_next/image?url=%5C%5Cremote.test%2Fa.png`,
  `${app}/organization/join?code=123456`,
])
  deny(() => localRequestSafe(url, app, db));

const rosterProjectId = "10000000-0000-4000-8000-000000000020";
const rosterActorId = randomUUID();
const rosterRequest = {
  method: "POST",
  url: `${db}/rest/v1/rpc/get_public_attendees`,
  headers: {
    authorization: "Bearer fictional-access-token",
    apikey: "fictional-anon-key",
    "content-type": "application/json",
  },
  body: JSON.stringify({ p_project_id: rosterProjectId }),
  actor: { id: rosterActorId, key: "csfAdmin", kind: "baseline" },
  entry: {
    id: "project-creator",
    route: `/projects/${rosterProjectId}`,
  },
  apiOrigin: db,
  anonKey: "fictional-anon-key",
  accessToken: "fictional-access-token",
  creatorProjects: new Map([[rosterProjectId, rosterActorId]]),
};
allow(() => projectRosterReaderRequest(rosterRequest));
deny(() => localRequestSafe(rosterRequest.url, app, db));
for (const change of [
  { method: "GET" },
  { url: `${db}/rest/v1/rpc/business_action` },
  { url: `${db}/rest/v1/rpc/get_public_attendees?select=*` },
  { url: `https://example.invalid/rest/v1/rpc/get_public_attendees` },
  { body: JSON.stringify({ p_project_id: rosterProjectId, mutate: true }) },
  { body: `{ "p_project_id": "${rosterProjectId}" }` },
  {
    body: `{"p_project_id":"${randomUUID()}","p_project_id":"${rosterProjectId}"}`,
  },
  { body: JSON.stringify({ p_project_id: randomUUID() }) },
  { actor: { ...rosterRequest.actor, key: "member" } },
  { entry: { ...rosterRequest.entry, id: "project-volunteer" } },
  { creatorProjects: new Map() },
  { accessToken: "other-token" },
  { headers: { ...rosterRequest.headers, apikey: "other-key" } },
  { headers: { ...rosterRequest.headers, "content-type": "text/plain" } },
  { headers: { ...rosterRequest.headers, "content-profile": "private" } },
])
  deny(() => projectRosterReaderRequest({ ...rosterRequest, ...change }));

const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "layout-contract-offline-")),
);
try {
  fs.mkdirSync(path.join(tmp, ".next"));
  fs.writeFileSync(path.join(tmp, ".next/BUILD_ID"), "obsolete");
  deny(() =>
    exactCompiledBuild(tmp, { buildDistDir: ".next", buildId: "obsolete" }),
  );
  deny(() =>
    exactCompiledBuild(tmp, {
      buildDistDir: BUILD_DIST_DIR,
      buildId: "obsolete",
    }),
  );
  const dir = path.join(tmp, BUILD_DIST_DIR);
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  const hashes = {};
  for (const file of BUILD_ARTIFACTS) {
    const data =
      file === "BUILD_ID"
        ? "offline-build\n"
        : file === "required-server-files.json"
          ? JSON.stringify({ config: { distDir: BUILD_DIST_DIR } })
          : "{}";
    fs.writeFileSync(path.join(dir, file), data);
    hashes[file] = digest(Buffer.from(data));
  }
  const m = {
    buildDistDir: BUILD_DIST_DIR,
    buildId: "offline-build",
    buildArtifactHashes: hashes,
  };
  allow(() => assert.equal(exactCompiledBuild(tmp, m), dir));
  deny(() => exactCompiledBuild(tmp, { ...m, buildId: "other" }));
  deny(() =>
    exactCompiledBuild(tmp, {
      ...m,
      buildArtifactHashes: { ...hashes, BUILD_ID: "0".repeat(64) },
    }),
  );
  deny(() =>
    exactCompiledBuild(tmp, {
      ...m,
      buildArtifactHashes: { BUILD_ID: hashes.BUILD_ID },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "required-server-files.json"),
    JSON.stringify({ config: { distDir: ".next" } }),
  );
  const mismatch = {
    ...hashes,
    "required-server-files.json": digest(
      fs.readFileSync(path.join(dir, "required-server-files.json")),
    ),
  };
  deny(() => exactCompiledBuild(tmp, { ...m, buildArtifactHashes: mismatch }));
} finally {
  fs.rmSync(tmp, { recursive: true });
}

const seed = await import(
  pathToFileURL(path.join(REPO, "scripts/local-dev/seed-platform-fixtures.mjs"))
);
const seedAccounts = seed.buildSeedFixtureSets(true).seededAccounts;
const baseline = baselineContracts(seedAccounts).map((a) => ({
  ...a,
  userId: randomUUID(),
}));
const marker = {
  runId: "offline-capture",
  projectId: "lets-assist-csf-browser-offline-capture",
};
const sqlSha = digest(
  fs.readFileSync(new URL("./retained-identities-proof.sql", import.meta.url)),
);
const sqlProof = {
  proofVersion: 1,
  namespace: "hours-acceptance-c8a61100",
  exactMarkerBinding: true,
  expectedIdentityCount: 1110,
  scopedAuthCount: 1110,
  matchedAuthCount: 1110,
  authMappingViolations: 0,
  scopedProfileCount: 1110,
  matchedProfileCount: 1110,
  profileMappingViolations: 0,
  proofValid: true,
};
const proof = {
  schema: "lets-assist-layout-fixture-proof-v2",
  syntheticOnly: true,
  seedMode: "csf-isolated-v1",
  ...marker,
  baselineActors: baseline,
  retainedHoursCount: 1110,
  hoursNamespace: "hours-acceptance-c8a61100",
  hoursIdentityProofSqlSha256: sqlSha,
  hoursIdentityProofBinding: marker,
  hoursIdentityProof: sqlProof,
};
const contracts = proofContracts(proof, marker, seedAccounts, sqlSha);
const users = contracts.map((a) => ({
  id: a.id,
  email: a.email,
  role: "authenticated",
  aud: "authenticated",
  phone: "",
  user_metadata: {
    ...a.metadata,
    full_name: a.fullName,
    username: a.username,
    avatar_url: a.avatarUrl,
  },
  app_metadata:
    a.kind === "hours"
      ? { ...a.metadata }
      : a.superAdmin
        ? { role: "super_admin", is_super_admin: true, local_fixture: true }
        : {},
}));
const profiles = contracts.map((a) => ({
  id: a.id,
  email: a.email,
  full_name: a.profileFullName ?? a.fullName,
  username: a.username,
  avatar_url: a.avatarUrl,
  phone: null,
}));
allow(() =>
  assert.equal(verifyFixtureRows(contracts, users, profiles).authUsers, 1132),
);
allow(() =>
  assert.equal(contracts.filter((a) => a.kind === "hours").length, 1110),
);
allow(() =>
  assert.equal(
    proofContracts(
      { ...proof, retainedHoursCount: 0 },
      marker,
      seedAccounts,
      sqlSha,
    ).length,
    22,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, retainedHoursCount: 1109 },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, runId: "different" },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    {
      ...proof,
      hoursIdentityProofBinding: { ...marker, projectId: "different" },
    },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, hoursIdentityProofSqlSha256: "0".repeat(64) },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, hoursIdentityProof: { ...sqlProof, proofValid: false } },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, hoursIdentityProof: { ...sqlProof, authMappingViolations: 1 } },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  proofContracts(
    { ...proof, baselineActors: [...baseline, baseline[0]] },
    marker,
    seedAccounts,
    sqlSha,
  ),
);
deny(() =>
  verifyFixtureRows(
    contracts,
    [...users, { ...users[0], id: randomUUID(), email: "real@local.test" }],
    profiles,
  ),
);
deny(() => verifyFixtureRows(contracts, users.slice(1), profiles));
for (const target of ["user", "app"]) {
  const bad = structuredClone(users),
    index = bad.findIndex((u) => u.id.startsWith("c8a61100-"));
  bad[index][
    target === "user" ? "user_metadata" : "app_metadata"
  ].local_fixture = "true";
  deny(() => verifyFixtureRows(contracts, bad, profiles));
}
for (const key of [
  "local_fixture_namespace",
  "local_fixture_run_id",
  "local_fixture_project_id",
]) {
  const bad = structuredClone(users),
    index = bad.findIndex((u) => u.id.startsWith("c8a61100-"));
  delete bad[index].user_metadata[key];
  deny(() => verifyFixtureRows(contracts, bad, profiles));
}
const badProfile = structuredClone(profiles),
  hourIndex = badProfile.findIndex((p) => p.id.startsWith("c8a61100-"));
badProfile[hourIndex].full_name = "Fictional hours volunteer 1";
deny(() => verifyFixtureRows(contracts, users, badProfile));
badProfile[hourIndex].full_name = "Fictional hours volunteer";
badProfile[hourIndex].avatar_url = "https://remote.test/p.png";
deny(() => verifyFixtureRows(contracts, users, badProfile));
deny(() => hoursContract(1111, marker));
const actor = contracts.find((a) => a.kind === "baseline"),
  token = "offline-fictional-token";
const socketUrl = `ws://127.0.0.1:55081/realtime/v1/websocket?apikey=offline-anon&vsn=2.0.0`;
allow(() => profileReaderUrl(socketUrl, db, "offline-anon", actor));
for (const value of [
  socketUrl.replace("55081", "55082"),
  socketUrl.replace("127.0.0.1", "localhost"),
  socketUrl.replace("ws:", "wss:"),
  socketUrl + "&extra=x",
  socketUrl.replace("2.0.0", "1.0.0"),
  socketUrl.replace("websocket", "other"),
  socketUrl.replace("offline-anon", "other"),
])
  deny(() => profileReaderUrl(value, db, "offline-anon", actor));
deny(() =>
  profileReaderUrl(
    socketUrl,
    db,
    "offline-anon",
    contracts.find((a) => a.kind === "hours"),
  ),
);
deny(() => profileReaderUrl(socketUrl, db, "offline-anon", null));
const join = [
  "1",
  "1",
  `realtime:profile-updates-${randomUUID()}-${actor.id}`,
  "phx_join",
  {
    access_token: token,
    config: {
      broadcast: { ack: false, self: false },
      presence: { key: "", enabled: false },
      private: false,
      postgres_changes: [
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${actor.id}`,
        },
      ],
    },
  },
];
allow(() =>
  assert.equal(
    profileReaderFrame(JSON.stringify(join), actor, token),
    "profile-join",
  ),
);
allow(() =>
  assert.equal(
    profileReaderFrame(
      JSON.stringify([null, "2", "phoenix", "heartbeat", {}]),
      actor,
      token,
    ),
    "heartbeat",
  ),
);
for (const event of [
  "broadcast",
  "presence",
  "access_token",
  "phx_leave",
  "business-send",
]) {
  const j = structuredClone(join);
  j[3] = event;
  deny(() => profileReaderFrame(JSON.stringify(j), actor, token));
}
for (const mutate of [
  (j) => (j[4].config.presence.enabled = true),
  (j) => (j[4].config.presence.key = "x"),
  (j) => (j[4].config.broadcast.ack = true),
  (j) => (j[4].config.private = true),
  (j) => (j[4].config.extra = true),
  (j) => j[4].config.postgres_changes.push(j[4].config.postgres_changes[0]),
  (j) => (j[4].config.postgres_changes[0].table = "projects"),
  (j) => (j[4].config.postgres_changes[0].filter = `id=eq.${randomUUID()}`),
  (j) => (j[4].access_token = "other"),
  (j) => (j[2] = j[2].replace(actor.id, randomUUID())),
  (j) => (j[4].business = { event: "x" }),
  (j) => (j[4].config.postgres_changes[0].schema = "auth"),
]) {
  const j = structuredClone(join);
  mutate(j);
  deny(() => profileReaderFrame(JSON.stringify(j), actor, token));
}
for (const frame of [
  Buffer.from("binary"),
  "not-json",
  "x".repeat(8193),
  JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {} }),
  JSON.stringify([null, "2", "phoenix", "heartbeat", { unexpected: true }]),
])
  deny(() => profileReaderFrame(frame, actor, token));
const aId = "1".repeat(40),
  sId = "2".repeat(40),
  wId = "6".repeat(40),
  pId = "4".repeat(40),
  sources = reviewedSourceHashes(REPO);
const compiled = {
  encryptionKey: "offline-secret-never-returned",
  node: {
    [pId]: {
      exportedName: "getLinkedIdentitiesAction",
      filename: path.join(REPO, "app/account/email-actions.ts"),
      workers: { "app/account/profile/page": { moduleId: "p", async: true } },
    },
    [aId]: {
      exportedName: "getDataExportJobs",
      filename: path.join(REPO, "app/account/security/actions.ts"),
      workers: { "app/account/security/page": { moduleId: "x", async: true } },
    },
    [sId]: {
      exportedName: "getOrganizerSignupsWithWaiverStatus",
      filename: path.join(REPO, "app/projects/[id]/signups/actions.ts"),
      workers: {
        "app/projects/[id]/signups/page": { moduleId: "y", async: true },
      },
    },
    [wId]: {
      exportedName: "getMyWaiverSignatures",
      filename: path.join(REPO, "app/projects/[id]/server/waiver-queries.ts"),
      workers: { "app/projects/[id]/page": { moduleId: "z", async: true } },
    },
  },
};
const policy = readActionPolicyFromCompiled(
  compiled,
  REPO,
  "3".repeat(64),
  sources,
);
allow(() => assert.equal(policy.enabled, false));
allow(() => assert.equal(policy.reviewed, false));
allow(() =>
  assert.equal(JSON.stringify(policy).includes(compiled.encryptionKey), false),
);
for (const mutate of [
  (c) => delete c.node[pId],
  (c) => (c.node[pId].exportedName = "setPrimaryEmailAction"),
  (c) => (c.node[pId].filename = "outside/actions.ts"),
  (c) => (c.node[pId].workers = {}),
  (c) => delete c.node[sId],
  (c) => delete c.node[wId],
  (c) => (c.node[wId].exportedName = "getWaiverDownloadUrl"),
  (c) => (c.node[wId].filename = "outside/actions.ts"),
  (c) => (c.node[wId].workers = {}),
  (c) => (c.node[aId].exportedName = "requestDataExport"),
  (c) => (c.node[aId].filename = "outside/actions.ts"),
  (c) => (c.node[aId].workers = {}),
  (c) => (c.node["5".repeat(40)] = c.node[aId]),
]) {
  const c = structuredClone(compiled);
  mutate(c);
  deny(() => readActionPolicyFromCompiled(c, REPO, "3".repeat(64), sources));
}
deny(() =>
  readActionPolicyFromCompiled(compiled, REPO, "3".repeat(64), {
    ...sources,
    "lib/supabase/admin.ts": "0".repeat(64),
  }),
);
const profileActor = contracts.find((a) => a.key === "member");
const profileRead = {
  method: "POST",
  url: `${app}/account/profile`,
  contentType: "text/plain;charset=UTF-8",
  actionId: pId,
  body: "[]",
  actor: profileActor,
  entry: {
    id: "account-profile",
    route: "/account/profile",
    readActions: ["getLinkedIdentitiesAction"],
  },
  baseURL: app,
  approvedActions: policy.approvedActions,
  creatorProjects: new Map(),
};
allow(() => readActionRequest(profileRead));
for (const change of [
  { method: "GET" },
  { url: `${app}/account/profile?other=x` },
  { url: `${app}/account/security` },
  { contentType: "application/json" },
  { body: "[1]" },
  { body: "not-json" },
  { actionId: aId },
  { actor: { ...profileActor, key: "developer" } },
  { entry: { ...profileRead.entry, id: "account-security" } },
  { entry: { ...profileRead.entry, route: "/account/security" } },
  { entry: { ...profileRead.entry, readActions: [] } },
])
  deny(() => readActionRequest({ ...profileRead, ...change }));
const request = {
  method: "POST",
  url: `${app}/account/security`,
  contentType: "text/plain;charset=UTF-8",
  actionId: aId,
  body: "[]",
  actor,
  entry: { route: "/account/security", readActions: ["getDataExportJobs"] },
  baseURL: app,
  approvedActions: policy.approvedActions,
  creatorProjects: new Map(),
};
allow(() => readActionRequest(request));
for (const change of [
  { method: "PUT" },
  { url: "https://lets-assist.com/account/security" },
  { url: `${app}/account/security?other=x` },
  { contentType: "multipart/form-data" },
  { body: "[1]" },
  { body: "not-json" },
  { body: " ".repeat(513) },
  { actionId: "0".repeat(40) },
  { actor: null },
  { entry: { route: "/account/security", readActions: [] } },
  { entry: { route: "/admin", readActions: ["getDataExportJobs"] } },
])
  deny(() => readActionRequest({ ...request, ...change }));
const project = seed.IDS.publicProject;
const volunteerActor = contracts.find((a) => a.key === "csfMember");
const waiverRead = {
  ...request,
  url: `${app}/projects/${project}`,
  actionId: wId,
  body: JSON.stringify([project]),
  actor: volunteerActor,
  entry: {
    id: "project-volunteer",
    route: `/projects/${project}`,
    readActions: ["getMyWaiverSignatures"],
  },
  creatorProjects: new Map([[project, actor.id]]),
};
allow(() => readActionRequest(waiverRead));
for (const change of [
  { body: "[]" },
  { body: JSON.stringify([project, project]) },
  { body: ` ["${project}"] ` },
  { body: JSON.stringify([seed.IDS.orgProject]) },
  { actionId: sId },
  { url: `${app}/projects/${project}?other=x` },
  { url: `${app}/projects/${seed.IDS.orgProject}` },
  { actor },
  { actor: { ...volunteerActor, key: "csfOfficer" } },
  { creatorProjects: new Map() },
  { creatorProjects: new Map([[project, volunteerActor.id]]) },
  { entry: { ...waiverRead.entry, id: "project-creator" } },
  { entry: { ...waiverRead.entry, readActions: [] } },
])
  deny(() => readActionRequest({ ...waiverRead, ...change }));
const roster = {
  ...request,
  url: `${app}/projects/${project}/signups`,
  actionId: sId,
  body: JSON.stringify([project]),
  entry: {
    route: `/projects/${project}/signups`,
    readActions: ["getOrganizerSignupsWithWaiverStatus"],
  },
  creatorProjects: new Map([[project, actor.id]]),
};
allow(() => readActionRequest(roster));
for (const change of [
  { body: "[]" },
  { body: JSON.stringify([project, project]) },
  { creatorProjects: new Map([[project, randomUUID()]]) },
  { url: `${app}/projects/${seed.IDS.orgProject}/signups` },
  { entry: { route: roster.entry.route, readActions: ["getDataExportJobs"] } },
])
  deny(() => readActionRequest({ ...roster, ...change }));
const template = JSON.parse(
  fs.readFileSync(
    new URL("./upstream/manifest.baseline-template.json", import.meta.url),
  ),
);
const inventory = JSON.parse(
  fs.readFileSync(
    new URL(
      "./upstream/original-route-role-state-inventory.json",
      import.meta.url,
    ),
  ),
);
allow(() => assert.equal(template.template, true));
allow(() => assert.equal(template.buildDistDir, BUILD_DIST_DIR));
allow(() => assert.equal(template.captures.length, 87));
allow(() => assert.equal(new Set(template.captures.map((c) => c.id)).size, 87));
allow(() => assert.equal(inventory.rootPageModules, 68));
allow(() => assert.equal(inventory.privateManifestRoutes, 22));
for (const entry of template.captures) {
  allow(() => {
    routeSafe(entry.route);
    assert(entry.ready.length > 0);
    assert(entry.expectedRoutes.includes(entry.route));
    if (entry.actorKey) assert(baseline.some((a) => a.key === entry.actorKey));
  });
}
deny(() =>
  proofContracts({ ...proof, template: true }, marker, seedAccounts, sqlSha),
);
const runtimeTemplate = JSON.parse(
  fs.readFileSync(
    new URL(
      "./upstream/original-runtime-binding.template.json",
      import.meta.url,
    ),
  ),
);
allow(() => assert.equal(runtimeTemplate.materialized, false));
allow(() => assert.equal(runtimeTemplate.fromCanonicalLaunch, false));
allow(() => assert.equal(runtimeTemplate.compiledFileHashes, null));
const observerTemplate = JSON.parse(
  fs.readFileSync(
    new URL(
      "./upstream/original-spawn-observer-opt-in.template.json",
      import.meta.url,
    ),
  ),
);
allow(() => assert.equal(observerTemplate.enabled, false));
allow(() => assert.equal(observerTemplate.allowRuntimeObservation, false));
allow(() => assert.equal(observerTemplate.outputDir, null));
allow(() => assert.equal(template.runtimeBindingFile, null));
allow(() => assert.equal(template.runtimeBindingSha256, null));
for (const change of [
  { authRole: "service_role" },
  { authPhone: "" },
  { profilePhone: "+15550000123" },
  { appRole: "super_admin" },
]) {
  const b = structuredClone(baseline);
  const index = b.findIndex((a) => !a.superAdmin);
  Object.assign(b[index], change);
  deny(() =>
    proofContracts(
      { ...proof, baselineActors: b },
      marker,
      seedAccounts,
      sqlSha,
    ),
  );
}
const { runRepairGuards } = await import("./repair-guard-tests.mjs");
const repairs = runRepairGuards({ contracts, users, profiles });
checks += repairs.checks;
const { runCacheGuards } = await import("./cache-guard-tests.mjs");
const cacheRepairs = runCacheGuards();
checks += cacheRepairs.checks;
process.stdout.write(
  JSON.stringify({
    repairs,
    cacheRepairs,
    selfTest: "PASS",
    checks,
    positiveRoutes: allowed.length,
    deniedRoutes: denied.length,
    fixtureBaselineActors: baseline.length,
    retainedHoursActors: 1110,
    networkStarted: false,
    browserStarted: false,
    serverStarted: false,
    actionsInvoked: 0,
    socketFramesSent: 0,
  }) + "\n",
);
