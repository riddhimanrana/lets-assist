import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_ROUTE,
  PLUGIN_SOURCE_HASHES,
  pluginReaderRequest,
  pluginPolicyFromCompiled,
  exactPluginPolicy,
} from "./plugin-reader-contract.mjs";
import {
  INVITATION_ORG_ID,
  invitationFixtureFromRows,
} from "./invitation-reader-contract.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const actor = {
  kind: "baseline",
  key: "developer",
  id: "20000000-0000-4000-8000-000000000001",
};
const organizationProof = invitationFixtureFromRows(
  [
    {
      id: INVITATION_ORG_ID,
      username: "local-platform-org",
      created_by: actor.id,
      staff_join_token: null,
      staff_join_token_created_at: null,
      staff_join_token_expires_at: null,
      staff_join_token_issued_by: null,
    },
  ],
  [
    {
      organization_id: INVITATION_ORG_ID,
      user_id: actor.id,
      role: "admin",
      status: "active",
    },
  ],
  actor,
);
const action = {
  actionId: "a".repeat(40),
  exportedName: "getOrganizationPluginSettings",
  sourceFile: "app/organization/[id]/settings/server/plugin-query.ts",
  worker: "app/organization/[id]/settings/page",
};
const compiled = () => ({
  node: {
    [action.actionId]: {
      exportedName: action.exportedName,
      filename: action.sourceFile,
      workers: { [action.worker]: {} },
    },
  },
});
const request = () => ({
  method: "POST",
  url: "http://127.0.0.1:3000" + PLUGIN_ROUTE,
  contentType: "text/plain;charset=utf-8",
  actionId: action.actionId,
  body: JSON.stringify([INVITATION_ORG_ID]),
  actor,
  organizationProof,
  entry: {
    id: "organization-settings-plugins",
    actorKey: "developer",
    route: PLUGIN_ROUTE,
    expectedRoutes: [PLUGIN_ROUTE],
    readActions: [action.exportedName],
  },
  baseURL: "http://127.0.0.1:3000",
  approvedActions: [action],
});

test("only the exact initial plugin getter maps to the reviewed settings worker", () => {
  const p = pluginPolicyFromCompiled(
    compiled(),
    repo,
    "b".repeat(64),
    PLUGIN_SOURCE_HASHES,
  );
  assert.deepEqual(p.approvedActions, [action]);
  assert.equal(pluginReaderRequest(request()), true);
});

for (const [name, change] of [
  [
    "installation mutation",
    (r) => {
      r.approvedActions = [
        { ...action, exportedName: "setOrganizationPluginInstallState" },
      ];
    },
  ],
  [
    "configuration mutation",
    (r) => {
      r.approvedActions = [
        { ...action, exportedName: "updateOrganizationPluginConfiguration" },
      ];
    },
  ],
  [
    "runtime mutation",
    (r) => {
      r.approvedActions = [
        { ...action, exportedName: "setOrganizationPluginApplicationRuntime" },
      ];
    },
  ],
  [
    "deletion mutation",
    (r) => {
      r.approvedActions = [
        { ...action, exportedName: "deleteOrganizationPluginData" },
      ];
    },
  ],
  [
    "unknown action",
    (r) => {
      r.actionId = "c".repeat(40);
    },
  ],
  [
    "different source",
    (r) => {
      r.approvedActions = [
        { ...action, sourceFile: "app/organization/[id]/settings/actions.ts" },
      ];
    },
  ],
  [
    "different worker",
    (r) => {
      r.approvedActions = [{ ...action, worker: "app/home/page" }];
    },
  ],
  [
    "different organization",
    (r) => {
      r.body = JSON.stringify([actor.id]);
    },
  ],
  [
    "extra argument",
    (r) => {
      r.body = JSON.stringify([INVITATION_ORG_ID, true]);
    },
  ],
  [
    "malformed body",
    (r) => {
      r.body = "[";
    },
  ],
  [
    "oversized body",
    (r) => {
      r.body = " ".repeat(513);
    },
  ],
  [
    "form mutation",
    (r) => {
      r.contentType = "multipart/form-data";
    },
  ],
  [
    "other method",
    (r) => {
      r.method = "PUT";
    },
  ],
  [
    "different actor",
    (r) => {
      r.actor = { ...actor, key: "csfAdmin" };
    },
  ],
  [
    "inactive membership",
    (r) => {
      r.organizationProof = { ...organizationProof, status: "inactive" };
    },
  ],
  [
    "non-admin",
    (r) => {
      r.organizationProof = { ...organizationProof, role: "staff" };
    },
  ],
  [
    "foreign origin",
    (r) => {
      r.url = "https://unapproved.invalid" + PLUGIN_ROUTE;
    },
  ],
  [
    "extra URL state",
    (r) => {
      r.url += "&change=true";
    },
  ],
  [
    "other scene",
    (r) => {
      r.entry.id = "organization-settings-danger";
    },
  ],
  [
    "undeclared action",
    (r) => {
      r.entry.readActions = [];
    },
  ],
  [
    "different expected route",
    (r) => {
      r.entry.expectedRoutes = ["/home"];
    },
  ],
])
  test(`plugin read contract refuses ${name}`, () => {
    const r = request();
    change(r);
    assert.throws(() => pluginReaderRequest(r));
  });

test("missing, ambiguous and wrongly sourced compiled mappings never acquire approval", () => {
  for (const changed of [
    { node: {} },
    {
      node: {
        ...compiled().node,
        ["c".repeat(40)]: compiled().node[action.actionId],
      },
    },
    {
      node: {
        [action.actionId]: {
          ...compiled().node[action.actionId],
          filename: "app/organization/[id]/settings/actions.ts",
        },
      },
    },
    {
      node: {
        [action.actionId]: { ...compiled().node[action.actionId], workers: {} },
      },
    },
  ])
    assert.throws(() =>
      pluginPolicyFromCompiled(
        changed,
        repo,
        "b".repeat(64),
        PLUGIN_SOURCE_HASHES,
      ),
    );
});

test("a changed reviewed dependency refuses approval before any runtime action", () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lets-assist-plugin-reader-")),
  );
  try {
    for (const file of Object.keys(PLUGIN_SOURCE_HASHES)) {
      const destination = path.join(root, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repo, file), destination);
    }
    pluginPolicyFromCompiled(
      compiled(),
      root,
      "b".repeat(64),
      PLUGIN_SOURCE_HASHES,
    );
    fs.appendFileSync(
      path.join(root, action.sourceFile),
      "\n// CHANGED OFFLINE FIXTURE ONLY\n",
    );
    assert.throws(() =>
      pluginPolicyFromCompiled(
        compiled(),
        root,
        "b".repeat(64),
        PLUGIN_SOURCE_HASHES,
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("disabled or unreviewed policy cannot admit an action", () => {
  assert.deepEqual(exactPluginPolicy(repo, "unused", { enabled: false }), []);
  assert.throws(() =>
    exactPluginPolicy(repo, "unused", { enabled: true, reviewed: false }),
  );
});
