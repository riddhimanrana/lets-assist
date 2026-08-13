import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type Row = Record<string, unknown>;

const organization = {
  id: "org-1",
  name: "Test Organization",
  username: "test-org",
  staff_join_token: "staff-token",
  staff_join_token_expires_at: "2026-09-01T00:00:00.000Z",
};
let memberships: Row[] = [];
let inserts = 0;
let updates = 0;

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
};

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));

const { applyStaffInviteForUser } = await import("./staff-invite");

beforeEach(() => {
  memberships = [];
  inserts = 0;
  updates = 0;
});

describe("applyStaffInviteForUser active authority", () => {
  test("denies redemption when the organization has no current active admin", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "former-admin",
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
    expect(
      memberships.some((membership) => membership.user_id === "invitee"),
    ).toBe(false);
  });

  test("does not revive or upgrade an inactive existing membership", async () => {
    memberships = [
      {
        organization_id: organization.id,
        user_id: "active-admin",
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
    expect(
      memberships.find((membership) => membership.user_id === "invitee"),
    ).toMatchObject({ role: "member", status: "inactive" });
  });
});
