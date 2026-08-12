import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

/**
 * `createOrganization`/`checkOrgUsername` are the only Server Actions that
 * insert `organizations.username`. RLS ("Create org with serialized
 * cooldown") also lets a trusted member insert directly, so the database
 * constraints in `20260811234500_organization_username_reserved_slugs.sql`
 * (proven in `organization_username_reserved_slugs.test.sql`) is the real
 * backstop -- but the Server Action must still refuse the reserved
 * usernames itself, with a truthful "reserved" error instead of the
 * misleading "already taken", and without reaching the insert at all.
 */

type AuthUser = { id: string; app_metadata?: Record<string, unknown> } | null;

let authUser: AuthUser = { id: "user-1" };
let profileTrustedMember: boolean | null = true;
let trustedMemberAppStatus: boolean | null = null;
let existingUsernames = new Set<string>();
let rateLimitCount = 0;
let organizationsSelectCalls = 0;
const insertedOrganizations: Array<Record<string, unknown>> = [];
const insertedMembers: Array<Record<string, unknown>> = [];

function serverClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: authUser }, error: null }),
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data:
                  profileTrustedMember === null
                    ? null
                    : { trusted_member: profileTrustedMember },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "trusted_member") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  trustedMemberAppStatus === null
                    ? null
                    : { status: trustedMemberAppStatus },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => {
                organizationsSelectCalls += 1;
                return {
                  data: existingUsernames.has(value)
                    ? { username: value }
                    : null,
                  error: null,
                };
              },
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                insertedOrganizations.push(row);
                return { data: { id: "org-1" }, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`serverClient: unexpected table ${table}`);
    },
  };
}

function adminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ count: rateLimitCount, error: null }),
            }),
          }),
        };
      }
      if (table === "organization_members") {
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedMembers.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`adminClient: unexpected table ${table}`);
    },
  };
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient(),
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient(),
}));

const { createOrganization, checkOrgUsername } = await import("./actions");

const baseCreateData = {
  name: "Test Organization",
  description: "A description that is long enough to pass validation.",
  website: "",
  type: "nonprofit" as const,
  logoUrl: null,
  createdBy: "user-1",
};

beforeEach(() => {
  authUser = { id: "user-1" };
  profileTrustedMember = true;
  trustedMemberAppStatus = null;
  existingUsernames = new Set();
  rateLimitCount = 0;
  organizationsSelectCalls = 0;
  insertedOrganizations.length = 0;
  insertedMembers.length = 0;
});

describe("checkOrgUsername", () => {
  test("reports every reserved slug spelling as unavailable without querying the database", async () => {
    for (const value of ["create", "CREATE", " join ", "Join"]) {
      expect(await checkOrgUsername(value)).toBe(false);
    }
    expect(organizationsSelectCalls).toBe(0);
  });

  test("reports an available, non-reserved username as available", async () => {
    expect(await checkOrgUsername("acme-nonprofit")).toBe(true);
    expect(organizationsSelectCalls).toBe(1);
  });

  test("reports a taken, non-reserved username as unavailable", async () => {
    existingUsernames.add("taken-org");
    expect(await checkOrgUsername("taken-org")).toBe(false);
  });

  test("rejects every invalid format without querying the database", async () => {
    for (const value of [
      "ab",
      "a".repeat(33),
      ".abc",
      "abc.",
      "ab..cd",
      "with space",
      "abc😀",
      `ab${String.fromCodePoint(0x1d400)}`,
    ]) {
      expect(await checkOrgUsername(value)).toBe(false);
    }
    expect(organizationsSelectCalls).toBe(0);
  });
});

describe("createOrganization reserved-slug enforcement", () => {
  test("refuses the reserved username 'create' with a truthful error and never inserts", async () => {
    const result = await createOrganization({
      ...baseCreateData,
      username: "create",
    });

    expect(result).toEqual({
      error: "That username is reserved and can't be used",
    });
    expect(insertedOrganizations).toHaveLength(0);
    expect(insertedMembers).toHaveLength(0);
  });

  test("refuses a case/whitespace variant of a reserved username", async () => {
    const result = await createOrganization({
      ...baseCreateData,
      username: "  JOIN  ",
    });

    expect(result).toEqual({
      error: "That username is reserved and can't be used",
    });
    expect(insertedOrganizations).toHaveLength(0);
  });

  test("does not misreport a reserved username as merely taken", async () => {
    // "already taken" would be false: the slug was never claimed by another
    // organization, so the error must name the actual reason.
    const result = await createOrganization({
      ...baseCreateData,
      username: "create",
    });
    expect(result.error).not.toBe("Username is already taken");
  });

  test("an ordinary, available username is still accepted and inserted", async () => {
    const result = await createOrganization({
      ...baseCreateData,
      username: "acme-nonprofit",
    });

    expect(result.success).toBe(true);
    expect(insertedOrganizations).toHaveLength(1);
    expect(insertedOrganizations[0]?.username).toBe("acme-nonprofit");
    expect(insertedMembers).toHaveLength(1);
    expect(insertedMembers[0]?.role).toBe("admin");
  });

  test("a direct Server Action call rejects ASCII, length, dot, and astral violations before insert", async () => {
    for (const username of [
      "ab",
      "a".repeat(33),
      ".abc",
      "abc.",
      "ab..cd",
      "slash/name",
      "abc😀",
      `ab${String.fromCodePoint(0x1d400)}`,
    ]) {
      const result = await createOrganization({
        ...baseCreateData,
        username,
      });
      expect(result.error).toBeString();
      expect(result.error).not.toBe("Username is already taken");
    }
    expect(insertedOrganizations).toHaveLength(0);
    expect(insertedMembers).toHaveLength(0);
  });

  test("an unauthenticated caller is rejected before the reserved-slug check runs", async () => {
    authUser = null;
    const result = await createOrganization({
      ...baseCreateData,
      username: "create",
    });
    expect(result).toEqual({
      error: "You must be logged in to create an organization",
    });
  });
});
