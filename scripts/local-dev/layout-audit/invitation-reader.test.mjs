import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invitationFixtureFromRows,
  verifyInvitationFixture,
  invitationReaderRequest,
  invitationPolicyFromCompiled,
  INVITATION_SOURCE_HASHES,
  INVITATION_ORG_ID,
  INVITATION_ROUTE,
} from "./invitation-reader-contract.mjs";

const actor = {
  kind: "baseline",
  key: "developer",
  id: "20000000-0000-4000-8000-000000000001",
};
const organizations = [
  {
    id: INVITATION_ORG_ID,
    username: "local-platform-org",
    created_by: actor.id,
    staff_join_token: null,
    staff_join_token_created_at: null,
    staff_join_token_expires_at: null,
    staff_join_token_issued_by: null,
  },
];
const memberships = [
  {
    organization_id: INVITATION_ORG_ID,
    user_id: actor.id,
    role: "admin",
    status: "active",
  },
];
const proof = invitationFixtureFromRows(organizations, memberships, actor);
const specs = [
  {
    exportedName: "getOrganizationInvitations",
    sourceFile: "app/organization/[id]/admin/server/invitations.ts",
    worker: "app/organization/[id]/settings/page",
    actionId: "a".repeat(40),
  },
  {
    exportedName: "getStaffLinkDetails",
    sourceFile: "app/organization/[id]/settings/server/profile.ts",
    worker: "app/organization/[id]/settings/page",
    actionId: "b".repeat(40),
  },
];
const request = (spec = specs[0]) => ({
  method: "POST",
  url: "http://127.0.0.1:3000" + INVITATION_ROUTE,
  contentType: "text/plain;charset=utf-8",
  actionId: spec.actionId,
  body: JSON.stringify(
    spec.exportedName === "getStaffLinkDetails"
      ? [INVITATION_ORG_ID]
      : [INVITATION_ORG_ID, "pending", 1, 10],
  ),
  actor,
  entry: {
    id: "organization-settings-invitations",
    actorKey: "developer",
    route: INVITATION_ROUTE,
    readActions: specs.map((s) => s.exportedName),
  },
  baseURL: "http://127.0.0.1:3000",
  approvedActions: specs,
  organizationProof: proof,
});

test("only the two initial own-organization readers pass", () => {
  for (const spec of specs)
    assert.equal(invitationReaderRequest(request(spec)), true);
});
test("fixture proof requires the actual active admin and an absent staff capability", () => {
  verifyInvitationFixture(proof, actor);
  for (const change of [
    (row) => {
      row.created_by = "FOREIGN";
    },
    (row) => {
      row.username = "foreign";
    },
    (row) => {
      row.staff_join_token = "PRIVATE_TOKEN";
    },
    (row) => {
      row.staff_join_token_expires_at = "2099-01-01";
    },
  ]) {
    const rows = structuredClone(organizations);
    change(rows[0]);
    assert.throws(() => invitationFixtureFromRows(rows, memberships, actor));
  }
  for (const change of [
    (row) => {
      row.role = "staff";
    },
    (row) => {
      row.status = "inactive";
    },
    (row) => {
      row.user_id = "FOREIGN";
    },
    (row) => {
      row.organization_id = "FOREIGN";
    },
  ]) {
    const rows = structuredClone(memberships);
    change(rows[0]);
    assert.throws(() => invitationFixtureFromRows(organizations, rows, actor));
  }
});
for (const [name, change] of [
  [
    "GET",
    (r) => {
      r.method = "GET";
    },
  ],
  [
    "foreign origin",
    (r) => {
      r.url = r.url.replace("127.0.0.1", "example.org");
    },
  ],
  [
    "general panel",
    (r) => {
      r.url = r.url.replace("invitations", "general");
    },
  ],
  [
    "extra query",
    (r) => {
      r.url += "&extra=1";
    },
  ],
  [
    "absent query",
    (r) => {
      r.url = r.url.split("?")[0];
    },
  ],
  [
    "oversized body",
    (r) => {
      r.body = "X".repeat(513);
    },
  ],
  [
    "binary MIME",
    (r) => {
      r.contentType = "application/octet-stream";
    },
  ],
  [
    "unknown action",
    (r) => {
      r.actionId = "c".repeat(40);
    },
  ],
  [
    "generate staff link",
    (r) => {
      r.approvedActions[0].exportedName = "generateStaffLink";
    },
  ],
  [
    "revoke staff link",
    (r) => {
      r.approvedActions[0].exportedName = "revokeStaffLink";
    },
  ],
  [
    "cancel invitation",
    (r) => {
      r.approvedActions[0].exportedName = "cancelInvitation";
    },
  ],
  [
    "resend invitation",
    (r) => {
      r.approvedActions[0].exportedName = "resendInvitation";
    },
  ],
  [
    "bulk invite",
    (r) => {
      r.approvedActions[0].exportedName = "bulkInviteMembers";
    },
  ],
  [
    "delete invitations",
    (r) => {
      r.approvedActions[0].exportedName = "deleteInvitations";
    },
  ],
  [
    "foreign actor",
    (r) => {
      r.actor.id = "30000000-0000-4000-8000-000000000001";
    },
  ],
  [
    "unreviewed scene",
    (r) => {
      r.entry.id = "organization-admin";
    },
  ],
  [
    "undeclared reader",
    (r) => {
      r.entry.readActions = [];
    },
  ],
  [
    "foreign organization",
    (r) => {
      r.body = JSON.stringify([
        "30000000-0000-4000-8000-000000000001",
        "pending",
        1,
        10,
      ]);
    },
  ],
  [
    "unbounded page",
    (r) => {
      r.body = JSON.stringify([INVITATION_ORG_ID, "pending", 2, 10]);
    },
  ],
  [
    "all statuses",
    (r) => {
      r.body = JSON.stringify([INVITATION_ORG_ID, "all", 1, 10]);
    },
  ],
  [
    "larger page size",
    (r) => {
      r.body = JSON.stringify([INVITATION_ORG_ID, "pending", 1, 50]);
    },
  ],
  [
    "operation argument",
    (r) => {
      r.actionId = specs[1].actionId;
      r.body = JSON.stringify([INVITATION_ORG_ID, "generate"]);
    },
  ],
  [
    "wrong source",
    (r) => {
      r.approvedActions[0].sourceFile = "unreviewed.ts";
    },
  ],
  [
    "wrong worker",
    (r) => {
      r.approvedActions[0].worker = "app/organization/[id]/admin/page";
    },
  ],
])
  test(`${name} remains refused`, () => {
    const r = structuredClone(request());
    change(r);
    assert.throws(() => invitationReaderRequest(r));
  });

test("exact reviewed source and both compiled mappings are required", () => {
  const compiled = {
    node: Object.fromEntries(
      specs.map((s) => [
        s.actionId,
        {
          exportedName: s.exportedName,
          filename: s.sourceFile,
          workers: { [s.worker]: {} },
        },
      ]),
    ),
  };
  const policy = invitationPolicyFromCompiled(
    compiled,
    process.cwd(),
    "c".repeat(64),
    INVITATION_SOURCE_HASHES,
  );
  assert.deepEqual(policy.approvedActions, specs);
  const missing = structuredClone(compiled);
  delete missing.node[specs[1].actionId];
  assert.throws(() =>
    invitationPolicyFromCompiled(
      missing,
      process.cwd(),
      "c".repeat(64),
      INVITATION_SOURCE_HASHES,
    ),
  );
  const duplicate = structuredClone(compiled);
  duplicate.node["d".repeat(40)] = duplicate.node[specs[0].actionId];
  assert.throws(() =>
    invitationPolicyFromCompiled(
      duplicate,
      process.cwd(),
      "c".repeat(64),
      INVITATION_SOURCE_HASHES,
    ),
  );
  const drift = {
    ...INVITATION_SOURCE_HASHES,
    [Object.keys(INVITATION_SOURCE_HASHES)[0]]: "0".repeat(64),
  };
  assert.throws(() =>
    invitationPolicyFromCompiled(
      compiled,
      process.cwd(),
      "c".repeat(64),
      drift,
    ),
  );
});
