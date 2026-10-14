import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { INVITATION_ORG_ID } from "./invitation-reader-contract.mjs";
import {
  INTEGRATION_ROUTE,
  INTEGRATION_SOURCE_HASHES,
  integrationFixtureFromRows,
  collectDisconnectedIntegrationFixture,
  integrationPolicyFromCompiled,
  exactIntegrationPolicy,
  integrationReaderRequest,
} from "./integration-reader-contract.mjs";
const actor = {
  kind: "baseline",
  key: "developer",
  id: "20000000-0000-4000-8000-000000000002",
};
const organizationProof = {
  schema: "lets-assist-invitation-reader-fixture-v1",
  organizationId: INVITATION_ORG_ID,
  organizationUsername: "local-platform-org",
  actorKey: "developer",
  actorId: actor.id,
  createdBy: actor.id,
  role: "admin",
  status: "active",
  staffTokenAbsent: true,
};
const rows = {
  calendarSyncs: [],
  sheetSyncs: [],
  organizationBindings: [],
  viewerConnections: [],
};
const integrationProof = integrationFixtureFromRows(
  organizationProof,
  actor,
  rows,
);
const worker = "app/organization/[id]/settings/page";
const actions = [
  {
    actionId: "a".repeat(40),
    exportedName: "getOrganizationCalendarStatus",
    sourceFile: "app/organization/[id]/calendar/actions.ts",
    worker,
  },
  {
    actionId: "b".repeat(40),
    exportedName: "getSheetSyncStatus",
    sourceFile: "app/organization/[id]/reports/server/status.ts",
    worker,
  },
];
const request = {
  method: "POST",
  url: "http://127.0.0.1:3000" + INTEGRATION_ROUTE,
  contentType: "text/plain;charset=utf-8",
  actionId: actions[0].actionId,
  body: JSON.stringify([INVITATION_ORG_ID]),
  actor,
  entry: {
    id: "organization-settings-integrations",
    actorKey: "developer",
    route: INTEGRATION_ROUTE,
    readActions: actions.map((a) => a.exportedName),
  },
  baseURL: "http://127.0.0.1:3000",
  approvedActions: actions,
  organizationProof,
  integrationProof,
};
test("only the two exact disconnected initial integration reads pass", () => {
  for (const action of actions)
    assert.equal(
      integrationReaderRequest({ ...request, actionId: action.actionId }),
      true,
    );
});
for (const name of Object.keys(rows)) {
  test(`a present ${name} record blocks the read before any connected/token/probe path`, () => {
    let readerInvocations = 0;
    assert.throws(() => {
      const proof = integrationFixtureFromRows(organizationProof, actor, {
        ...rows,
        [name]: [{ id: "fictional-connected-record" }],
      });
      integrationReaderRequest({ ...request, integrationProof: proof });
      readerInvocations++;
    });
    assert.equal(readerInvocations, 0);
  });
  test(`a missing ${name} observation is never treated as empty`, () => {
    const incomplete = { ...rows };
    delete incomplete[name];
    assert.throws(() =>
      integrationFixtureFromRows(organizationProof, actor, incomplete),
    );
  });
}
for (const field of [
  "calendarConfigAbsent",
  "sheetConfigAbsent",
  "organizationBindingsAbsent",
  "viewerConnectionsAbsent",
]) {
  test(`connected ${field} metadata blocks token refresh and destination probing`, () => {
    assert.throws(() =>
      integrationReaderRequest({
        ...request,
        integrationProof: { ...integrationProof, [field]: false },
      }),
    );
  });
}
test("metadata collector uses exact IDs, bounded rows and no credential columns", async () => {
  const log = [];
  const admin = {
    from(table) {
      const read = { table };
      log.push(read);
      const query = {
        select(columns) {
          read.columns = columns;
          return query;
        },
        eq(column, value) {
          read.filter = [column, value];
          return query;
        },
        async range(start, end) {
          assert.deepEqual([start, end], [0, 0]);
          return { data: [], error: null };
        },
      };
      return query;
    },
  };
  assert.deepEqual(
    await collectDisconnectedIntegrationFixture(
      admin,
      organizationProof,
      actor,
    ),
    integrationProof,
  );
  assert.deepEqual(
    log.map((r) => r.table),
    [
      "organization_calendar_syncs",
      "organization_sheet_syncs",
      "user_google_oauth_connection_bindings",
      "user_calendar_connections",
    ],
  );
  assert.deepEqual(
    log.map((r) => r.filter),
    [
      ["organization_id", INVITATION_ORG_ID],
      ["organization_id", INVITATION_ORG_ID],
      ["organization_id", INVITATION_ORG_ID],
      ["user_id", actor.id],
    ],
  );
  assert.ok(
    log.every((r) => ["organization_id", "user_id"].includes(r.columns)),
  );
});
test("a failed metadata query refuses the disconnected proof", async () => {
  const admin = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        range: async () => ({
          data: [],
          error: { message: "private error is not logged" },
        }),
      };
    },
  };
  await assert.rejects(
    collectDisconnectedIntegrationFixture(admin, organizationProof, actor),
  );
});
const denied = [
  ["GET", { method: "GET" }],
  ["foreign origin", { url: "https://remote.test" + INTEGRATION_ROUTE }],
  ["calendar alias", { url: request.url.replace("integrations", "calendar") }],
  ["extra query", { url: request.url + "&success=connected" }],
  ["fragment", { url: request.url + "#settings" }],
  ["binary MIME", { contentType: "application/octet-stream" }],
  ["oversized body", { body: "x".repeat(513) }],
  ["malformed body", { body: "not JSON" }],
  [
    "foreign organization",
    { body: JSON.stringify(["30000000-0000-4000-8000-000000000003"]) },
  ],
  ["refresh argument", { body: JSON.stringify([INVITATION_ORG_ID, true]) }],
  [
    "foreign actor",
    { actor: { ...actor, id: "30000000-0000-4000-8000-000000000003" } },
  ],
  [
    "non-admin",
    { organizationProof: { ...organizationProof, role: "member" } },
  ],
  [
    "wrong scene",
    { entry: { ...request.entry, id: "organization-settings-general" } },
  ],
  ["undeclared action", { entry: { ...request.entry, readActions: [] } }],
  ["unknown action", { actionId: "c".repeat(40) }],
  [
    "wrong source",
    { approvedActions: [{ ...actions[0], sourceFile: "unreviewed.ts" }] },
  ],
  [
    "wrong worker",
    { approvedActions: [{ ...actions[0], worker: "app/other/page" }] },
  ],
];
for (const [name, change] of denied)
  test(`${name} remains refused`, () =>
    assert.throws(() => integrationReaderRequest({ ...request, ...change })));
for (const exportedName of [
  "getAvailableSheetOwners",
  "getSheetsAccessTokenForPicker",
  "syncSheetNow",
  "createSheetSync",
  "updateSheetOwner",
  "updateOrganizationCalendarSettings",
  "syncOrganizationCalendarNow",
  "disconnectOrganizationCalendar",
]) {
  test(`${exportedName} is never allowed by a getter-like name`, () =>
    assert.throws(() =>
      integrationReaderRequest({
        ...request,
        approvedActions: [{ ...actions[0], exportedName }],
      }),
    ));
}
test("actual reviewed bytes and unique exact compiled mappings are required", () => {
  const repo = fs.mkdtempSync(
    path.join(os.tmpdir(), "lets-assist-integration-contract-"),
  );
  try {
    for (const file of Object.keys(INTEGRATION_SOURCE_HASHES)) {
      const destination = path.join(repo, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), file), destination);
    }
    const compiled = {
      node: Object.fromEntries(
        actions.map((a) => [
          a.actionId,
          {
            exportedName: a.exportedName,
            filename: a.sourceFile,
            workers: { [worker]: {} },
          },
        ]),
      ),
    };
    const bytes = JSON.stringify(compiled),
      sha = createHash("sha256").update(bytes).digest("hex");
    const policy = integrationPolicyFromCompiled(
      compiled,
      repo,
      sha,
      INTEGRATION_SOURCE_HASHES,
    );
    assert.deepEqual(policy.approvedActions, actions);
    const build = path.join(repo, "build");
    fs.mkdirSync(path.join(build, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(build, "server/server-reference-manifest.json"),
      bytes,
    );
    assert.deepEqual(exactIntegrationPolicy(repo, build, policy), actions);
    const missing = structuredClone(compiled);
    delete missing.node[actions[0].actionId];
    assert.throws(() =>
      integrationPolicyFromCompiled(
        missing,
        repo,
        sha,
        INTEGRATION_SOURCE_HASHES,
      ),
    );
    const duplicate = structuredClone(compiled);
    duplicate.node["c".repeat(40)] = duplicate.node[actions[0].actionId];
    assert.throws(() =>
      integrationPolicyFromCompiled(
        duplicate,
        repo,
        sha,
        INTEGRATION_SOURCE_HASHES,
      ),
    );
    const foreign = structuredClone(compiled);
    foreign.node[actions[0].actionId].workers = { "app/other/page": {} };
    assert.throws(() =>
      integrationPolicyFromCompiled(
        foreign,
        repo,
        sha,
        INTEGRATION_SOURCE_HASHES,
      ),
    );
    assert.throws(() =>
      exactIntegrationPolicy(repo, build, {
        ...policy,
        compiledManifestSha256: "0".repeat(64),
      }),
    );
    fs.appendFileSync(
      path.join(repo, actions[1].sourceFile),
      "\n// source drift\n",
    );
    assert.throws(() =>
      integrationPolicyFromCompiled(
        compiled,
        repo,
        sha,
        INTEGRATION_SOURCE_HASHES,
      ),
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
