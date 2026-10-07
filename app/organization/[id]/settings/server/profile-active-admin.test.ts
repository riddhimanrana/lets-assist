import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

type Row = Record<string, unknown>;

let membershipStatus = "active";
let revokeAfterOrganizationRead = false;
let organizationWrites = 0;
let revokeAtRpc = false;
const rpcCalls: Row[] = [];
const organizationPatches: Row[] = [];

class MembershipQuery {
  private filters: Array<[string, unknown]> = [];

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  async single() {
    return this.result();
  }

  async maybeSingle() {
    return this.result();
  }

  private result() {
    const row = {
      organization_id: "org-1",
      user_id: "admin-1",
      role: "admin",
      status: membershipStatus,
    };
    const matches = this.filters.every(
      ([column, value]) => row[column as keyof typeof row] === value,
    );
    return { data: matches ? row : null, error: null };
  }
}

class OrganizationQuery {
  select() {
    return this;
  }

  eq() {
    return this;
  }

  async single() {
    if (revokeAfterOrganizationRead) {
      membershipStatus = "inactive";
    }
    return {
      data: {
        username: "test-org",
        logo_url: null,
        verified: false,
        auto_join_domain: null,
      },
      error: null,
    };
  }

  update(patch: Row) {
    return {
      eq: async () => {
        organizationWrites += 1;
        organizationPatches.push(patch);
        return { error: null };
      },
    };
  }
}

const serverClient = {
  from(table: string) {
    if (table === "organization_members") return new MembershipQuery();
    if (table === "organizations") return new OrganizationQuery();
    throw new Error(`Unexpected server table: ${table}`);
  },
};

const adminClient = {
  async rpc(name: string, args: Row) {
    expect(name).toBe("manage_organization_staff_invite");
    rpcCalls.push(args);
    if (revokeAtRpc) membershipStatus = "inactive";
    if (membershipStatus !== "active")
      return {
        data: null,
        error: { code: "42501", message: "private membership detail" },
      };
    organizationWrites += args.p_operation === "get" ? 0 : 1;
    return {
      data:
        args.p_operation === "generate"
          ? {
              success: true,
              token: "synthetic-staff-token",
              expiresAt: "2026-11-01T00:00:00Z",
            }
          : args.p_operation === "revoke"
            ? { success: true }
            : {
                hasToken: true,
                token: "synthetic-staff-token",
                createdAt: "2026-10-01T00:00:00Z",
                expiresAt: "2026-11-01T00:00:00Z",
                isExpired: false,
              },
      error: null,
    };
  },
  from(table: string) {
    if (table === "organization_members") return new MembershipQuery();
    if (table === "organizations") return new OrganizationQuery();
    throw new Error(`Unexpected admin table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: "admin-1" } }),
}));

const {
  generateStaffLink,
  revokeStaffLink,
  getStaffLinkDetails,
  updateOrganization,
} = await import("./profile");

beforeEach(() => {
  membershipStatus = "active";
  revokeAfterOrganizationRead = false;
  organizationWrites = 0;
  revokeAtRpc = false;
  rpcCalls.length = 0;
  organizationPatches.length = 0;
});

describe("organization settings active admin revalidation", () => {
  test("an inactive admin cannot generate a staff token through the service client", async () => {
    membershipStatus = "inactive";

    const result = await generateStaffLink("org-1");

    expect(result).toEqual({
      error: "Only admins can generate staff invite links",
    });
    expect(organizationWrites).toBe(0);
  });

  test("revocation after the initial organization read prevents the final privileged update", async () => {
    revokeAfterOrganizationRead = true;

    const result = await updateOrganization({
      id: "org-1",
      name: "Test Organization",
      username: "test-org",
      description: "Updated",
      website: undefined,
      type: "school",
      logoUrl: undefined,
    });

    expect(result).toEqual({
      error: "Only admins can update organization details",
    });
    expect(organizationWrites).toBe(0);
  });

  test("staff token generation binds the token to the authenticated active admin", async () => {
    const result = await generateStaffLink("org-1");

    expect(result.success).toBe(true);
    expect(rpcCalls).toEqual([
      {
        p_actor: "admin-1",
        p_organization: "org-1",
        p_operation: "generate",
        p_expires_days: 30,
      },
    ]);
    expect(organizationPatches).toHaveLength(0);
  });

  test("staff token revocation clears its issuer binding", async () => {
    const result = await revokeStaffLink("org-1");

    expect(result).toEqual({ success: true });
    expect(rpcCalls).toEqual([
      { p_actor: "admin-1", p_organization: "org-1", p_operation: "revoke" },
    ]);
    expect(organizationPatches).toHaveLength(0);
  });
});

for (const [operation, action] of [
  ["generate", generateStaffLink],
  ["revoke", revokeStaffLink],
  ["get", getStaffLinkDetails],
] as const) {
  test(`revocation after the preliminary check refuses staff ${operation} through the atomic boundary`, async () => {
    revokeAtRpc = true;
    const result = await action("org-1");
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("private membership detail");
    expect(organizationWrites).toBe(0);
    expect(rpcCalls[0]).toMatchObject({
      p_actor: "admin-1",
      p_organization: "org-1",
      p_operation: operation,
    });
  });
}
