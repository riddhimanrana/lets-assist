import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyStaffInviteForUser } from "./staff-invite";

interface MockError {
  code?: string;
  message?: string;
}

interface MockConfig {
  organization?: {
    id: string;
    name: string;
    username: string;
    staff_join_token: string | null;
    staff_join_token_expires_at: string | null;
  };
  organizationError?: MockError | null;
  insertError?: MockError | null;
  existingMembership?: { role: string } | null;
  existingMembershipError?: MockError | null;
  updateError?: MockError | null;
}

function createMockAdminClient(config: MockConfig = {}) {
  const organizationSingle = vi.fn(async () => ({
    data: config.organization ?? null,
    error: config.organizationError ?? null,
  }));

  const memberInsert = vi.fn(async () => ({
    error: config.insertError ?? null,
  }));

  const membershipSingle = vi.fn(async () => ({
    data: config.existingMembership ?? null,
    error: config.existingMembershipError ?? null,
  }));

  const updateFinalEq = vi.fn(async () => ({
    error: config.updateError ?? null,
  }));

  const updateOrgEq = vi.fn(() => ({ eq: updateFinalEq }));
  const update = vi.fn(() => ({ eq: updateOrgEq }));

  const client = {
    from: vi.fn((table: string) => {
      if (table === "organizations") {
        const orgEq = vi.fn(() => ({ single: organizationSingle }));
        return {
          select: vi.fn(() => ({ eq: orgEq })),
        };
      }

      if (table === "organization_members") {
        const memberSecondEq = vi.fn(() => ({ single: membershipSingle }));
        const memberFirstEq = vi.fn(() => ({ eq: memberSecondEq }));
        return {
          insert: memberInsert,
          select: vi.fn(() => ({ eq: memberFirstEq })),
          update,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    spies: {
      memberInsert,
      update,
      updateOrgEq,
      updateFinalEq,
      membershipSingle,
      organizationSingle,
    },
  };
}

describe("applyStaffInviteForUser", () => {
  const now = new Date("2026-02-28T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when organization and token are valid", async () => {
    const { client, spies } = createMockAdminClient({
      organization: {
        id: "org-1",
        name: "Troop 941",
        username: "troop941",
        staff_join_token: "valid-token",
        staff_join_token_expires_at: "2026-03-01T12:00:00.000Z",
      },
    });

    const result = await applyStaffInviteForUser(
      {
        userId: "user-1",
        staffToken: "valid-token",
        orgUsername: "troop941",
      },
      { adminClient: client as never, now },
    );

    expect(result).toEqual({
      status: "success",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });
    expect(spies.memberInsert).toHaveBeenCalledTimes(1);
  });

  it("returns invalid_token when token does not match", async () => {
    const { client, spies } = createMockAdminClient({
      organization: {
        id: "org-1",
        name: "Troop 941",
        username: "troop941",
        staff_join_token: "other-token",
        staff_join_token_expires_at: "2026-03-01T12:00:00.000Z",
      },
    });

    const result = await applyStaffInviteForUser(
      {
        userId: "user-1",
        staffToken: "valid-token",
        orgUsername: "troop941",
      },
      { adminClient: client as never, now },
    );

    expect(result).toEqual({
      status: "invalid_token",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });
    expect(spies.memberInsert).not.toHaveBeenCalled();
  });

  it("returns expired_token when token is expired", async () => {
    const { client, spies } = createMockAdminClient({
      organization: {
        id: "org-1",
        name: "Troop 941",
        username: "troop941",
        staff_join_token: "valid-token",
        staff_join_token_expires_at: "2026-02-27T12:00:00.000Z",
      },
    });

    const result = await applyStaffInviteForUser(
      {
        userId: "user-1",
        staffToken: "valid-token",
        orgUsername: "troop941",
      },
      { adminClient: client as never, now },
    );

    expect(result).toEqual({
      status: "expired_token",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });
    expect(spies.memberInsert).not.toHaveBeenCalled();
  });

  it("upgrades duplicate member role to staff", async () => {
    const { client, spies } = createMockAdminClient({
      organization: {
        id: "org-1",
        name: "Troop 941",
        username: "troop941",
        staff_join_token: "valid-token",
        staff_join_token_expires_at: "2026-03-01T12:00:00.000Z",
      },
      insertError: { code: "23505" },
      existingMembership: { role: "member" },
    });

    const result = await applyStaffInviteForUser(
      {
        userId: "user-1",
        staffToken: "valid-token",
        orgUsername: "troop941",
      },
      { adminClient: client as never, now },
    );

    expect(result).toEqual({
      status: "success",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.updateFinalEq).toHaveBeenCalledTimes(1);
  });

  it("does not downgrade existing staff/admin role on duplicate membership", async () => {
    const { client, spies } = createMockAdminClient({
      organization: {
        id: "org-1",
        name: "Troop 941",
        username: "troop941",
        staff_join_token: "valid-token",
        staff_join_token_expires_at: "2026-03-01T12:00:00.000Z",
      },
      insertError: { code: "23505" },
      existingMembership: { role: "admin" },
    });

    const result = await applyStaffInviteForUser(
      {
        userId: "user-1",
        staffToken: "valid-token",
        orgUsername: "troop941",
      },
      { adminClient: client as never, now },
    );

    expect(result).toEqual({
      status: "success",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });
    expect(spies.update).not.toHaveBeenCalled();
  });
});