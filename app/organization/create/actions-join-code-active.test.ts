import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));

let membershipRole: "admin" | "staff" | "member" = "admin";
let membershipStatus = "active";
let deactivateAfterServerMembershipRead = false;
let deactivateAfterFirstRotation = false;
let collisionAttemptsRemaining = 0;
let rotationAttempts = 0;
let privilegedReads = 0;

class MembershipQuery {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly source: "server" | "admin") {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push([column, values]);
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
      user_id: "user-1",
      role: membershipRole,
      status: membershipStatus,
    };
    const matches = this.filters.every(([column, value]) =>
      Array.isArray(value)
        ? value.includes(row[column as keyof typeof row])
        : row[column as keyof typeof row] === value,
    );
    const data = matches ? { ...row } : null;
    if (
      this.source === "server" &&
      data &&
      deactivateAfterServerMembershipRead
    ) {
      membershipStatus = "inactive";
    }
    return { data, error: null };
  }
}

class AdminOrganizationQuery {
  select() {
    privilegedReads += 1;
    return this;
  }

  eq() {
    return this;
  }

  async maybeSingle() {
    return { data: { join_code: "654321" }, error: null };
  }

  update() {
    return {
      eq: () => ({
        select: () => ({
          single: async () => {
            rotationAttempts += 1;
            if (deactivateAfterFirstRotation && rotationAttempts === 1) {
              membershipStatus = "inactive";
            }
            if (collisionAttemptsRemaining > 0) {
              collisionAttemptsRemaining -= 1;
              return {
                data: null,
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "organizations_join_code_unique_idx"',
                },
              };
            }
            return { data: { join_code: "654321" }, error: null };
          },
        }),
      }),
    };
  }
}

const serverClient = {
  auth: {
    getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
  },
  from(table: string) {
    if (table === "organization_members") {
      return new MembershipQuery("server");
    }
    throw new Error(`Unexpected server table: ${table}`);
  },
};

const adminClient = {
  from(table: string) {
    if (table === "organization_members") {
      return new MembershipQuery("admin");
    }
    if (table === "organizations") {
      return new AdminOrganizationQuery();
    }
    throw new Error(`Unexpected admin table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

const { getOrganizationJoinCode, regenerateJoinCode } =
  await import("./actions");

beforeEach(() => {
  membershipRole = "admin";
  membershipStatus = "active";
  deactivateAfterServerMembershipRead = false;
  deactivateAfterFirstRotation = false;
  collisionAttemptsRemaining = 0;
  rotationAttempts = 0;
  privilegedReads = 0;
});

describe("join-code active membership boundaries", () => {
  test("an inactive admin cannot rotate the join code", async () => {
    membershipStatus = "inactive";

    expect(await regenerateJoinCode("org-1")).toEqual({
      error: "Only admins can regenerate join codes",
    });
    expect(rotationAttempts).toBe(0);
  });

  test("each collision retry rechecks active admin authority immediately before writing", async () => {
    collisionAttemptsRemaining = 1;
    deactivateAfterFirstRotation = true;

    expect(await regenerateJoinCode("org-1")).toEqual({
      error: "Only admins can regenerate join codes",
    });
    expect(rotationAttempts).toBe(1);
  });

  test("an inactive staff membership cannot read the join code", async () => {
    membershipRole = "staff";
    membershipStatus = "inactive";

    expect(await getOrganizationJoinCode("org-1")).toEqual({
      error: "You cannot view this join code",
    });
    expect(privilegedReads).toBe(0);
  });

  test("revocation after an earlier staff result prevents the admin-client read", async () => {
    membershipRole = "staff";
    deactivateAfterServerMembershipRead = true;

    expect(await getOrganizationJoinCode("org-1")).toEqual({
      error: "You cannot view this join code",
    });
    expect(privilegedReads).toBe(0);
  });
});
