import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
  listFactors: vi.fn(),
}));

vi.mock("./server", () => ({
  createClient: mocks.createClient,
}));

import { getAuthUser } from "./auth-helpers";

describe("getAuthUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: mocks.getClaims,
        getUser: mocks.getUser,
        mfa: {
          listFactors: mocks.listFactors,
        },
      },
    });

    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "user-123",
          email: "volunteer@example.com",
          phone: null,
          role: "authenticated",
          aal: "aal1",
          user_metadata: { full_name: "Volunteer Example" },
          app_metadata: {},
        },
      },
      error: null,
    });

    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    mocks.listFactors.mockResolvedValue({
      data: {
        totp: [],
        phone: [],
      },
      error: null,
    });
  });

  it("returns the authenticated user when no MFA challenge is pending", async () => {
    const result = await getAuthUser();

    expect(result).toEqual({
      user: {
        id: "user-123",
        email: "volunteer@example.com",
        phone: null,
        role: "authenticated",
        user_metadata: { full_name: "Volunteer Example" },
        app_metadata: {},
      },
      error: null,
    });

    expect(mocks.listFactors).toHaveBeenCalledTimes(1);
  });

  it("treats an aal1 to aal2 session as not fully authenticated by default", async () => {
    mocks.listFactors.mockResolvedValue({
      data: {
        totp: [
          {
            id: "factor-1",
            factor_type: "totp",
            status: "verified",
          },
        ],
        phone: [],
      },
      error: null,
    });

    const result = await getAuthUser();

    expect(result).toEqual({
      user: null,
      error: null,
      requiresMfa: true,
    });
  });

  it("can return the user when MFA-pending access is explicitly allowed", async () => {
    mocks.listFactors.mockResolvedValue({
      data: {
        totp: [
          {
            id: "factor-1",
            factor_type: "totp",
            status: "verified",
          },
        ],
        phone: [],
      },
      error: null,
    });

    const result = await getAuthUser({ allowMfaPending: true });

    expect(result).toEqual({
      user: {
        id: "user-123",
        email: "volunteer@example.com",
        phone: null,
        role: "authenticated",
        user_metadata: { full_name: "Volunteer Example" },
        app_metadata: {},
      },
      error: null,
    });
  });
});