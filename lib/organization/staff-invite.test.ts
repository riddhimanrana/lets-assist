import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type Row = Record<string, unknown>;

const organization = {
  id: "org-1",
  name: "Test Organization",
  username: "test-org",
  staff_join_token: "staff-token",
  staff_join_token_expires_at: "2026-09-01T00:00:00.000Z",
  staff_join_token_issued_by: "issuer-admin" as string | null,
};
let memberships: Row[] = [];
let inserts = 0;
let updates = 0;
let rpcCalls = 0;

class Query {
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  limit() {
    return this;
  }

  async single() {
    const data = this.rows()[0] ?? null;
    return { data, error: data ? null : { code: "PGRST116" } };
  }

  async maybeSingle() {
    return { data: this.rows()[0] ?? null, error: null };
  }

  async insert(row: Row) {
    inserts += 1;
    const duplicate = memberships.some(
      (membership) =>
        membership.organization_id === row.organization_id &&
        membership.user_id === row.user_id,
    );
    if (duplicate) {
      return { error: { code: "23505" } };
    }
    memberships.push({ ...row, status: "active" });
    return { error: null };
  }

  update(patch: Row) {
    return {
      eq: (column: string, value: unknown) => {
        this.filters.push([column, value]);
        return {
          eq: async (nextColumn: string, nextValue: unknown) => {
            this.filters.push([nextColumn, nextValue]);
            updates += 1;
            for (const row of this.rows()) Object.assign(row, patch);
            return { error: null };
          },
        };
      },
    };
  }

  private rows() {
    const rows =
      this.table === "organizations"
        ? [organization]
        : this.table === "organization_members"
          ? memberships
          : [];
    return rows.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );
  }
}

const adminClient = {
  from(table: string) {
    return new Query(table);
  },
  async rpc(name: string, payload: Record<string, unknown>) {
    if (name !== "redeem_staff_join_token") {
      throw new Error(`Unexpected RPC: ${name}`);
    }
    rpcCalls += 1;

    const base = {
      org_username: organization.username,
      org_name: organization.name,
    };
    if (
      payload.p_org_username !== organization.username ||
      payload.p_staff_token !== organization.staff_join_token ||
      !organization.staff_join_token_issued_by
    ) {
      return {
        data: [{ status: "invalid_token", ...base }],
        error: null,
      };
    }

    const issuer = memberships.find(
      (row) =>
        row.organization_id === organization.id &&
        row.user_id === organization.staff_join_token_issued_by &&
        row.role === "admin" &&
        row.status === "active",
    );
    if (!issuer) {
      return { data: [{ status: "error", ...base }], error: null };
    }

    const target = memberships.find(
      (row) =>
        row.organization_id === organization.id &&
        row.user_id === payload.p_user_id,
    );
    if (target?.status !== undefined && target.status !== "active") {
      return { data: [{ status: "error", ...base }], error: null };
    }
    if (!target) {
      inserts += 1;
      memberships.push({
        organization_id: organization.id,
        user_id: payload.p_user_id,
        role: "staff",
        status: "active",
      });
    } else if (target.role === "member") {
      updates += 1;
      target.role = "staff";
    }
    return { data: [{ status: "success", ...base }], error: null };
  },
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

const { applyStaffInviteForUser } = await import("./staff-invite");

beforeEach(() => {
  memberships = [];
  inserts = 0;
  updates = 0;
  rpcCalls = 0;
  organization.staff_join_token_issued_by = "issuer-admin";
});

describe("applyStaffInviteForUser active authority", () => {
  test("denies redemption when the organization has no current active admin", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "issuer-admin",
        role: "admin",
        status: "inactive",
      },
    ];

    const result = await applyStaffInviteForUser(
      {
        userId: "invitee",
        staffToken: "staff-token",
        orgUsername: organization.username,
      },
      {
        adminClient: adminClient as never,
        now: new Date("2026-08-12T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("error");
    expect(inserts).toBe(0);
    expect(rpcCalls).toBe(1);
    expect(
      memberships.some((membership) => membership.user_id === "invitee"),
    ).toBe(false);
  });

  test("does not revive or upgrade an inactive existing membership", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "issuer-admin",
        role: "admin",
        status: "active",
      },
      {
        organization_id: organization.id,
        user_id: "invitee",
        role: "member",
        status: "inactive",
      },
    ];

    const result = await applyStaffInviteForUser(
      {
        userId: "invitee",
        staffToken: "staff-token",
        orgUsername: organization.username,
      },
      {
        adminClient: adminClient as never,
        now: new Date("2026-08-12T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("error");
    expect(updates).toBe(0);
    expect(rpcCalls).toBe(1);
    expect(
      memberships.find((membership) => membership.user_id === "invitee"),
    ).toMatchObject({ role: "member", status: "inactive" });
  });

  test("an unrelated active admin cannot authorize a token issued by an inactive admin", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "issuer-admin",
        role: "admin",
        status: "inactive",
      },
      {
        organization_id: organization.id,
        user_id: "other-admin",
        role: "admin",
        status: "active",
      },
    ];

    const result = await applyStaffInviteForUser(
      {
        userId: "invitee",
        staffToken: "staff-token",
        orgUsername: organization.username,
      },
      {
        adminClient: adminClient as never,
        now: new Date("2026-08-12T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("error");
    expect(rpcCalls).toBe(1);
    expect(inserts).toBe(0);
  });

  test("legacy tokens without an issuer fail closed", async () => {
    organization.staff_join_token_issued_by = null;
    memberships = [
      {
        organization_id: organization.id,
        user_id: "other-admin",
        role: "admin",
        status: "active",
      },
    ];

    const result = await applyStaffInviteForUser(
      {
        userId: "invitee",
        staffToken: "staff-token",
        orgUsername: organization.username,
      },
      {
        adminClient: adminClient as never,
        now: new Date("2026-08-12T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("invalid_token");
    expect(rpcCalls).toBe(1);
    expect(inserts).toBe(0);
  });

  test("an active issuer atomically creates staff membership through the RPC", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "issuer-admin",
        role: "admin",
        status: "active",
      },
    ];

    const result = await applyStaffInviteForUser(
      {
        userId: "invitee",
        staffToken: "staff-token",
        orgUsername: organization.username,
      },
      {
        adminClient: adminClient as never,
        now: new Date("2026-08-12T12:00:00.000Z"),
      },
    );

    expect(result.status).toBe("success");
    expect(rpcCalls).toBe(1);
    expect(inserts).toBe(1);
    expect(
      memberships.find((membership) => membership.user_id === "invitee"),
    ).toMatchObject({ role: "staff", status: "active" });
  });
});
