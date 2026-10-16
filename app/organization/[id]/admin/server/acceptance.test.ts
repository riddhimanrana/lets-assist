import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { method: string; args: unknown[] };
type Row = Record<string, unknown>;
type Failure = { code: string; message: string };

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_ID = "fictional-actor";
const ORGANIZATION_ID = "fictional-organization";
const INVITATION_ID = "fictional-invitation";
const OUTAGE: Failure = { code: "08006", message: "synthetic outage" };

let actor: { id: string; email?: string; user_metadata: Row } | null = null;
let invitation: Row = {};
let members: Row[] = [];
let memberSequence = 0;

let invitationReadFailure: Failure | null = null;
let membershipReadFailure: Failure | null = null;
let memberInsertFailure: Failure | null = null;
let memberUpdateFailure: Failure | null = null;
let invitationWriteFailures = 0;
let beforeMemberInsert: (() => void) | null = null;
let beforeMemberUpdate: (() => void) | null = null;
let beforeInvitationWrite: (() => void) | null = null;
let membershipReads = 0;
let memberInserts = 0;
let memberUpdates = 0;
let profileImports = 0;

function matches(row: Row, ops: Op[]) {
  return ops
    .filter((op) => op.method === "eq")
    .every((op) => row[op.args[0] as string] === op.args[1]);
}

/** A two-table store that applies every filter the action sends. */
function makeClient() {
  return {
    from: (table: string) => {
      const ops: Op[] = [];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          ops.push({ method, args });
          return builder;
        };
      }
      const payload = (method: string) =>
        ops.find((op) => op.method === method)?.args[0] as Row | undefined;

      const settle = () => {
        if (table === "organization_invitations") {
          const update = payload("update");
          if (update) {
            beforeInvitationWrite?.();
            if (invitationWriteFailures > 0) {
              invitationWriteFailures -= 1;
              return { data: null, error: OUTAGE };
            }
            if (!matches(invitation, ops)) return { data: null, error: null };
            Object.assign(invitation, update);
            return { data: { id: invitation.id }, error: null };
          }
          if (invitationReadFailure) {
            return { data: null, error: invitationReadFailure };
          }
          return matches(invitation, ops)
            ? { data: invitation, error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } };
        }

        if (table !== "organization_members") {
          throw new Error(`Unexpected table ${table}`);
        }

        const insert = payload("insert");
        if (insert) {
          memberInserts += 1;
          beforeMemberInsert?.();
          if (memberInsertFailure) return { error: memberInsertFailure };
          const duplicate = members.some(
            (row) =>
              row.organization_id === insert.organization_id &&
              row.user_id === insert.user_id,
          );
          if (duplicate) {
            return { error: { code: "23505", message: "duplicate key" } };
          }
          memberSequence += 1;
          members.push({ ...insert, id: `member-${memberSequence}` });
          return { error: null };
        }

        const update = payload("update");
        if (update) {
          memberUpdates += 1;
          beforeMemberUpdate?.();
          if (memberUpdateFailure) {
            return { data: null, error: memberUpdateFailure };
          }
          const row = members.find((candidate) => matches(candidate, ops));
          if (row) Object.assign(row, update);
          return { data: row ? { id: row.id } : null, error: null };
        }

        membershipReads += 1;
        if (membershipReadFailure) {
          return { data: null, error: membershipReadFailure };
        }
        return {
          data: members.find((row) => matches(row, ops)) ?? null,
          error: null,
        };
      };

      builder.single = async () => settle();
      builder.maybeSingle = async () => settle();
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(settle()).then(onFulfilled, onRejected);
      return builder;
    },
  };
}

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: actor }),
}));
mock.module("./shared", () => ({
  applyImportedProfileData: async () => {
    profileImports += 1;
  },
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => makeClient(),
}));

const { acceptInvitation } = await import("./acceptance");

function existingMember(role: string, status: string | null) {
  members = [
    {
      id: "member-existing",
      organization_id: ORGANIZATION_ID,
      user_id: ACTOR_ID,
      role,
      status,
    },
  ];
}

function expectStillPending() {
  expect(invitation.status).toBe("pending");
  expect(invitation.accepted_by).toBeUndefined();
  expect(profileImports).toBe(0);
}

const ORGANIZATION_URL = "/organization/fictional-org";

beforeEach(() => {
  actor = { id: ACTOR_ID, email: "invitee@example.test", user_metadata: {} };
  invitation = {
    id: INVITATION_ID,
    token: TOKEN,
    email: "Invitee@example.test",
    role: "staff",
    status: "pending",
    expires_at: "2099-01-01T00:00:00Z",
    organization_id: ORGANIZATION_ID,
    organization: { name: "Fictional org", username: "fictional-org" },
  };
  members = [];
  memberSequence = 0;
  invitationReadFailure = null;
  membershipReadFailure = null;
  memberInsertFailure = null;
  memberUpdateFailure = null;
  invitationWriteFailures = 0;
  beforeMemberInsert = null;
  beforeMemberUpdate = null;
  beforeInvitationWrite = null;
  membershipReads = 0;
  memberInserts = 0;
  memberUpdates = 0;
  profileImports = 0;
});

describe("an existing member is promoted before the invitation is consumed", () => {
  test("a failed role write leaves the invitation pending and the role unchanged", async () => {
    existingMember("member", "active");
    memberUpdateFailure = OUTAGE;

    const result = await acceptInvitation(TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain("still pending");
    expect(members[0].role).toBe("member");
    expectStillPending();
  });

  test("a role write that matches no row leaves the invitation pending and reactivates nothing", async () => {
    existingMember("member", "active");
    // An administrator deactivates the member after the membership read.
    beforeMemberUpdate = () => {
      members[0].status = "inactive";
    };

    const result = await acceptInvitation(TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain("still pending");
    expect(members[0]).toMatchObject({ role: "member", status: "inactive" });
    expectStillPending();
  });

  test("a role raised concurrently is never lowered to the invited role", async () => {
    existingMember("member", "active");
    beforeMemberUpdate = () => {
      members[0].role = "admin";
    };

    const result = await acceptInvitation(TOKEN);

    expect(result.success).toBe(false);
    expect(members[0].role).toBe("admin");
    expectStillPending();

    // The retry sees the higher role and only records the acceptance.
    beforeMemberUpdate = null;
    expect(await acceptInvitation(TOKEN)).toEqual({
      success: true,
      redirectUrl: ORGANIZATION_URL,
    });
    expect(members[0].role).toBe("admin");
    expect(memberUpdates).toBe(1);
  });

  test("an active member is promoted and the invitation is accepted by that account", async () => {
    existingMember("member", "active");

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: true,
      redirectUrl: ORGANIZATION_URL,
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: "staff", status: "active" });
    expect(invitation).toMatchObject({
      status: "accepted",
      accepted_by: ACTOR_ID,
    });
    expect(memberInserts).toBe(0);
    expect(profileImports).toBe(1);
  });

  test("a higher existing role is kept and the invitation is accepted", async () => {
    existingMember("admin", "active");
    invitation.role = "member";

    expect(await acceptInvitation(TOKEN)).toMatchObject({ success: true });
    expect(members[0].role).toBe("admin");
    expect(memberUpdates).toBe(0);
    expect(invitation.status).toBe("accepted");
  });

  test("a staff member invited as admin is told they are already a member", async () => {
    existingMember("staff", "active");
    invitation.role = "admin";

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "You are already a member of this organization",
    });
    expect(members[0].role).toBe("staff");
    expectStillPending();
  });
});

describe("a retry finishes an acceptance whose last write was lost", () => {
  test("a new member whose acceptance write failed is not inserted twice", async () => {
    invitationWriteFailures = 1;

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Failed to finalize invitation acceptance",
    });
    expect(members).toHaveLength(1);
    expectStillPending();

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: true,
      redirectUrl: ORGANIZATION_URL,
    });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: "staff", status: "active" });
    expect(memberInserts).toBe(1);
    expect(invitation).toMatchObject({
      status: "accepted",
      accepted_by: ACTOR_ID,
    });
  });

  test("a promoted member whose acceptance write failed is not promoted again", async () => {
    existingMember("member", "active");
    invitationWriteFailures = 1;

    expect((await acceptInvitation(TOKEN)).success).toBe(false);
    expect(members[0].role).toBe("staff");
    expectStillPending();

    expect(await acceptInvitation(TOKEN)).toMatchObject({ success: true });
    expect(memberUpdates).toBe(1);
    expect(invitation.status).toBe("accepted");
  });

  test("a concurrent accept that already created the membership converges", async () => {
    beforeMemberInsert = () => {
      beforeMemberInsert = null;
      existingMember("staff", "active");
    };

    expect(await acceptInvitation(TOKEN)).toMatchObject({ success: true });
    expect(members).toHaveLength(1);
    expect(invitation.status).toBe("accepted");
  });

  test("a concurrent accept by the same account that consumed the invitation is success", async () => {
    beforeInvitationWrite = () => {
      beforeInvitationWrite = null;
      Object.assign(invitation, { status: "accepted", accepted_by: ACTOR_ID });
    };

    expect(await acceptInvitation(TOKEN)).toMatchObject({ success: true });
    expect(members).toHaveLength(1);
  });

  test("an invitation cancelled before the last write is not reported as accepted", async () => {
    beforeInvitationWrite = () => {
      beforeInvitationWrite = null;
      invitation.status = "cancelled";
    };

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "This invitation is no longer valid",
    });
    expect(invitation.status).toBe("cancelled");
    expect(invitation.accepted_by).toBeUndefined();
    expect(profileImports).toBe(0);
  });
});

describe("a membership that is not active is never reactivated", () => {
  for (const status of ["inactive", "pending", "suspended", null]) {
    test(`a membership whose status is ${status} refuses the invitation`, async () => {
      existingMember("staff", status);

      const result = await acceptInvitation(TOKEN);

      expect(result.success).toBe(false);
      expect(result.error).toContain("restore your membership");
      expect(members[0]).toMatchObject({ role: "staff", status });
      expect(memberInserts).toBe(0);
      expect(memberUpdates).toBe(0);
      expectStillPending();
    });
  }

  test("a membership that appears inactive during a concurrent insert is not accepted", async () => {
    beforeMemberInsert = () => {
      beforeMemberInsert = null;
      existingMember("staff", "inactive");
    };

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Failed to join organization",
    });
    expect(members[0].status).toBe("inactive");
    expectStillPending();
  });
});

describe("only the invited, signed-in email reaches membership", () => {
  test("a different signed-in email consumes nothing and touches no membership", async () => {
    actor = { id: ACTOR_ID, email: "other@example.test", user_metadata: {} };

    const result = await acceptInvitation(TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invitee@example.test");
    expect(membershipReads).toBe(0);
    expect(memberInserts).toBe(0);
    expect(members).toHaveLength(0);
    expectStillPending();
  });

  test("an account with no email consumes nothing", async () => {
    actor = { id: ACTOR_ID, user_metadata: {} };

    expect((await acceptInvitation(TOKEN)).success).toBe(false);
    expect(memberInserts).toBe(0);
    expectStillPending();
  });

  test("a signed-out visitor is asked to sign in", async () => {
    actor = null;

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Please sign in to accept this invitation",
    });
    expect(memberInserts).toBe(0);
    expectStillPending();
  });
});

describe("read and write failures consume nothing", () => {
  test("a failed membership read is not treated as no membership", async () => {
    existingMember("staff", "inactive");
    membershipReadFailure = OUTAGE;

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Could not check membership. Please try again.",
    });
    expect(memberInserts).toBe(0);
    expect(members[0].status).toBe("inactive");
    expectStillPending();
  });

  test("a failed invitation read is not reported as a missing invitation", async () => {
    invitationReadFailure = OUTAGE;

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Could not load this invitation. Please try again.",
    });
    expect(memberInserts).toBe(0);
  });

  test("a failed membership insert leaves the invitation pending", async () => {
    memberInsertFailure = OUTAGE;

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "Failed to join organization",
    });
    expect(members).toHaveLength(0);
    expectStillPending();
  });

  test("an expired invitation is marked expired and creates no membership", async () => {
    invitation.expires_at = "2020-01-01T00:00:00Z";

    expect(await acceptInvitation(TOKEN)).toEqual({
      success: false,
      error: "This invitation has expired",
    });
    expect(invitation.status).toBe("expired");
    expect(members).toHaveLength(0);
    expect(profileImports).toBe(0);
  });

  test("a token that is not an invitation token is not looked up", async () => {
    expect(await acceptInvitation("not-a-token")).toEqual({
      success: false,
      error: "Invitation not found",
    });
    expect(membershipReads).toBe(0);
  });
});
