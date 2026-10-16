import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createRequire } from "node:module";
import {
  CSF_SETTINGS_ROUTE,
  CSF_SETTINGS_SOURCE_HASHES,
  CSF_SETTINGS_READERS,
  csfSettingsFixtureFromRows,
  verifyCsfSettingsFixture,
  collectCsfSettingsFixture,
  csfSettingsPolicyFromCompiled,
  exactCsfSettingsPolicy,
  csfSettingsReaderRequest,
} from "./csf-settings-reader-contract.mjs";
const repo = process.cwd();
const actor = {
  kind: "baseline",
  key: "csfAdmin",
  id: "20000000-0000-4000-8000-000000000001",
};
const organizationId = "20000000-0000-4000-8000-000000000002";
const worker = "app/organization/[id]/page";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function rows() {
  return {
    runtimeAccess: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        is_accessible: true,
        latest_version: "1.2.89",
        force_update_version: null,
      },
    ],
    organizations: [{ id: organizationId, username: "dvhs-csf" }],
    memberships: [
      {
        organization_id: organizationId,
        user_id: actor.id,
        role: "admin",
        status: "active",
      },
    ],
    entitlements: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        status: "active",
      },
    ],
    installs: [
      {
        organization_id: organizationId,
        plugin_key: "dvhs-csf",
        enabled: true,
        installed_version: "1.2.89",
      },
    ],
    organizationBindings: [],
    actorBindings: [],
    connections: [],
    testWorkspaces: [],
    destinations: [],
  };
}
const fixtureProof = csfSettingsFixtureFromRows(actor, organizationId, rows());
function readerAdmin(data = rows(), errorTable) {
  const queries = [];
  const make = (schema = "public") => ({
    from(table) {
      const query = { schema, table, fields: null, filters: [], range: null };
      const chain = {
        select(fields) {
          query.fields = fields;
          return chain;
        },
        eq(key, value) {
          query.filters.push([key, value]);
          return chain;
        },
        range(start, end) {
          query.range = [start, end];
          queries.push(query);
          const names = {
            organizations: "organizations",
            organization_members: "memberships",
            organization_plugin_entitlements: "entitlements",
            organization_plugin_installs: "installs",
            organization_plugin_access: "runtimeAccess",
            user_calendar_connections: "connections",
            csf_sheet_sync_test_workspaces: "testWorkspaces",
            csf_sheet_sync_destinations: "destinations",
          };
          const name =
            table === "user_google_oauth_connection_bindings"
              ? query.filters.some(([k]) => k === "user_id")
                ? "actorBindings"
                : "organizationBindings"
              : names[table];
          assert(name, "Unknown table");
          return Promise.resolve({
            data: data[name],
            error: table === errorTable ? { code: "synthetic" } : null,
          });
        },
      };
      return chain;
    },
  });
  return {
    queries,
    ...make(),
    schema(name) {
      assert.equal(name, "plugin_data");
      return make(name);
    },
  };
}
function compiled() {
  return {
    node: Object.fromEntries(
      CSF_SETTINGS_READERS.map((spec, i) => [
        (i + 10).toString(16).repeat(40),
        {
          exportedName: spec.exportedName,
          filename: spec.sourceFile,
          workers: { [worker]: { moduleId: "fictional" } },
        },
      ]),
    ),
  };
}
function policy() {
  return csfSettingsPolicyFromCompiled(
    compiled(),
    repo,
    "f".repeat(64),
    CSF_SETTINGS_SOURCE_HASHES,
  );
}
function request(index = 0) {
  const actions = policy().approvedActions;
  return {
    method: "POST",
    url: "http://127.0.0.1:3000" + CSF_SETTINGS_ROUTE,
    contentType: "text/plain;charset=utf-8",
    actionId: actions[index].actionId,
    body: JSON.stringify(
      index === 0 ? [organizationId, "import_members"] : [organizationId],
    ),
    actor,
    entry: {
      id: "csf-settings",
      actorKey: "csfAdmin",
      route: CSF_SETTINGS_ROUTE,
      readActions: CSF_SETTINGS_READERS.map((s) => s.exportedName),
    },
    baseURL: "http://127.0.0.1:3000",
    approvedActions: actions,
    fixtureProof,
    organizationId,
  };
}
test("metadata reads prove the exact active disconnected normal fixture", async () => {
  const admin = readerAdmin();
  assert.deepEqual(
    await collectCsfSettingsFixture(admin, actor, organizationId),
    fixtureProof,
  );
  assert.equal(admin.queries.length, 10);
  for (const query of admin.queries) {
    assert(!/token|credential|secret|configuration|\*/iu.test(query.fields));
    assert(query.range[1] <= 1);
  }
  assert.equal(
    admin.queries.filter((q) => q.schema === "plugin_data").length,
    2,
  );
});
for (const name of Object.keys(rows()))
  test(`missing or changed ${name} refuses fixture credit`, () => {
    const missing = rows();
    delete missing[name];
    assert.throws(() =>
      csfSettingsFixtureFromRows(actor, organizationId, missing),
    );
    const changed = rows();
    changed[name] = [{ unknown: true }];
    assert.throws(() =>
      csfSettingsFixtureFromRows(actor, organizationId, changed),
    );
  });
for (const [name, column, value] of [
  ["memberships", "status", "inactive"],
  ["memberships", "role", "staff"],
  ["memberships", "user_id", organizationId],
  ["organizations", "username", "other"],
  ["installs", "enabled", false],
  ["installs", "installed_version", "1.2.88"],
  ["entitlements", "status", "inactive"],
  ["runtimeAccess", "is_accessible", false],
  ["runtimeAccess", "force_update_version", "1.2.90"],
])
  test(`${name}.${column} cannot borrow fixture authority`, () => {
    const data = rows();
    data[name][0][column] = value;
    assert.throws(() =>
      csfSettingsFixtureFromRows(actor, organizationId, data),
    );
  });
test("proofs reject another actor, organization and extra metadata", () => {
  for (const changed of [
    { ...actor, key: "developer" },
    { ...actor, id: organizationId },
    { ...actor, kind: "retained" },
  ])
    assert.throws(() =>
      verifyCsfSettingsFixture(fixtureProof, changed, organizationId),
    );
  assert.throws(() => verifyCsfSettingsFixture(fixtureProof, actor, actor.id));
  assert.throws(() =>
    verifyCsfSettingsFixture(
      { ...fixtureProof, secret: "redacted" },
      actor,
      organizationId,
    ),
  );
});
for (const table of [
  "organizations",
  "organization_members",
  "organization_plugin_installs",
  "organization_plugin_access",
  "user_google_oauth_connection_bindings",
  "user_calendar_connections",
  "csf_sheet_sync_test_workspaces",
  "csf_sheet_sync_destinations",
])
  test(`${table} read errors never establish absence`, async () => {
    await assert.rejects(
      collectCsfSettingsFixture(
        readerAdmin(rows(), table),
        actor,
        organizationId,
      ),
    );
  });
test("compiled review accepts only the three exact implementation/worker mappings", () => {
  assert.equal(policy().approvedActions.length, 3);
  for (const change of [
    (m) => delete m.node[Object.keys(m.node)[0]],
    (m) => {
      const [first] = Object.keys(m.node);
      m.node["e".repeat(40)] = m.node[first];
    },
    (m) => {
      Object.values(m.node)[0].filename = "neighbor.ts";
    },
    (m) => {
      Object.values(m.node)[0].workers = { other: {} };
    },
    (m) => {
      Object.values(m.node)[0].exportedName =
        "disconnectCsfGoogleConnectionAction";
    },
  ]) {
    const m = compiled();
    change(m);
    assert.throws(() =>
      csfSettingsPolicyFromCompiled(
        m,
        repo,
        "f".repeat(64),
        CSF_SETTINGS_SOURCE_HASHES,
      ),
    );
  }
  const hashes = { ...CSF_SETTINGS_SOURCE_HASHES };
  delete hashes[Object.keys(hashes)[0]];
  assert.throws(() =>
    csfSettingsPolicyFromCompiled(compiled(), repo, "f".repeat(64), hashes),
  );
});
test("owned compiled bytes and the reviewed action list must remain exact", (t) => {
  const build = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "csf-settings-policy-")),
  );
  t.after(() => fs.rmSync(build, { recursive: true, force: true }));
  fs.mkdirSync(path.join(build, "server"));
  const file = path.join(build, "server/server-reference-manifest.json"),
    bytes = Buffer.from(JSON.stringify(compiled()));
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  const p = csfSettingsPolicyFromCompiled(
    compiled(),
    repo,
    sha(bytes),
    CSF_SETTINGS_SOURCE_HASHES,
  );
  assert.equal(exactCsfSettingsPolicy(repo, build, p).length, 3);
  assert.throws(() =>
    exactCsfSettingsPolicy(repo, build, { ...p, reviewed: false }),
  );
  assert.throws(() =>
    exactCsfSettingsPolicy(repo, build, {
      ...p,
      approvedActions: p.approvedActions.slice(1),
    }),
  );
  fs.appendFileSync(file, " ");
  assert.throws(() => exactCsfSettingsPolicy(repo, build, p));
});
for (let i = 0; i < 3; i++)
  test(`initial reader ${i} rechecks all ten fixture reads immediately before admission`, async () => {
    const admin = readerAdmin();
    assert.equal(
      await csfSettingsReaderRequest({ ...request(i), admin }),
      true,
    );
    assert.equal(admin.queries.length, 10);
  });
const mutations = [
  { method: "GET" },
  { contentType: "application/json" },
  { actionId: "unknown" },
  { body: "[]" },
  { body: JSON.stringify([actor.id, "import_members"]) },
  { body: JSON.stringify([organizationId, "import_applications"]) },
  { url: "http://127.0.0.1:3000" + CSF_SETTINGS_ROUTE + "&extra=1" },
  { url: "https://lets-assist.com" + CSF_SETTINGS_ROUTE },
  { entry: { ...request().entry, id: "csf-help" } },
  { entry: { ...request().entry, readActions: [] } },
  { actor: { ...actor, key: "developer" } },
  { approvedActions: [] },
  { body: "x".repeat(513) },
];
for (const [i, change] of mutations.entries())
  test(`unreviewed request ${i} is refused without even fixture queries`, async () => {
    const admin = readerAdmin();
    await assert.rejects(
      csfSettingsReaderRequest({ ...request(), ...change, admin }),
    );
    assert.equal(admin.queries.length, 0);
  });
for (const field of [
  "organizationBindings",
  "actorBindings",
  "connections",
  "testWorkspaces",
  "destinations",
])
  test(`fresh ${field} drift stops a previously valid reader`, async () => {
    const data = rows();
    data[field] = [{}];
    const admin = readerAdmin(data);
    await assert.rejects(csfSettingsReaderRequest({ ...request(), admin }));
    assert.equal(admin.queries.length, 10);
  });
test("test-copy recovery and neighboring writes are never approved", async () => {
  const admin = readerAdmin();
  const r = request();
  for (const exportedName of [
    "getCsfSheetCopyRecoveryAction",
    "disconnectCsfGoogleConnectionAction",
    "registerCsfSheetSyncDestinationAction",
  ]) {
    await assert.rejects(
      csfSettingsReaderRequest({
        ...r,
        admin,
        approvedActions: [{ ...r.approvedActions[0], exportedName }],
      }),
    );
  }
  assert.equal(admin.queries.length, 0);
});

test("a current install may satisfy an earlier reviewed minimum version", () => {
  const data = rows();
  data.runtimeAccess[0].force_update_version = "1.2.70";
  assert.deepEqual(
    csfSettingsFixtureFromRows(actor, organizationId, data),
    fixtureProof,
  );
});

test("the real SDK collector emits only bounded metadata GETs on the owned loopback origin", async () => {
  const require = createRequire(path.join(repo, "package.json"));
  const { createClient } = require("@supabase/supabase-js");
  const data = rows(),
    seen = [];
  const admin = createClient(
    "http://127.0.0.1:54321",
    "fictional-service-key",
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init),
            u = new URL(request.url);
          assert.equal(request.method, "GET");
          assert.equal(u.origin, "http://127.0.0.1:54321");
          const table = u.pathname.split("/").at(-1);
          const names = {
            organizations: "organizations",
            organization_members: "memberships",
            organization_plugin_entitlements: "entitlements",
            organization_plugin_installs: "installs",
            organization_plugin_access: "runtimeAccess",
            user_calendar_connections: "connections",
            csf_sheet_sync_test_workspaces: "testWorkspaces",
            csf_sheet_sync_destinations: "destinations",
          };
          const name =
            table === "user_google_oauth_connection_bindings"
              ? u.searchParams.has("user_id")
                ? "actorBindings"
                : "organizationBindings"
              : names[table];
          assert(name);
          assert(
            !/token|credential|secret|configuration|\*/iu.test(
              u.searchParams.get("select"),
            ),
          );
          assert(Number(u.searchParams.get("limit")) <= 2);
          seen.push({
            pathname: u.pathname,
            schema: request.headers.get("accept-profile"),
          });
          return new Response(JSON.stringify(data[name]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );
  assert.deepEqual(
    await collectCsfSettingsFixture(admin, actor, organizationId),
    fixtureProof,
  );
  assert.equal(seen.length, 10);
  assert.equal(seen.filter((x) => x.schema === "plugin_data").length, 2);
});
