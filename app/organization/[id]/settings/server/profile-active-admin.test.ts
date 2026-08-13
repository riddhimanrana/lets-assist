import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

type Row = Record<string, unknown>;

let membershipStatus = "active";
let revokeAfterOrganizationRead = false;
let organizationWrites = 0;

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

  update(_patch: Row) {
    return {
      eq: async () => {
        organizationWrites += 1;
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

const { generateStaffLink, updateOrganization } = await import("./profile");

beforeEach(() => {
  membershipStatus = "active";
  revokeAfterOrganizationRead = false;
  organizationWrites = 0;
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
});
