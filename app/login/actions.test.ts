import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  getAuthUser: vi.fn(),
  applyStaffInviteForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: mocks.getAuthUser,
}));

vi.mock("@/lib/organization/staff-invite", () => ({
  applyStaffInviteForUser: mocks.applyStaffInviteForUser,
}));

import { applyStaffInviteForCurrentUser, signInWithGoogle } from "./actions";

describe("login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://lets-assist.test";

    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithOAuth: mocks.signInWithOAuth,
      },
    });

    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://oauth.example/continue" },
      error: null,
    });
  });

  it("includes redirect and invite context in Google OAuth callback URL", async () => {
    const result = await signInWithGoogle("/home?tab=calendar", {
      staffToken: "abc-token",
      orgUsername: "troop941",
    });

    expect(result).toEqual({ url: "https://oauth.example/continue" });
    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);

    const signInPayload = mocks.signInWithOAuth.mock.calls[0]?.[0] as {
      options?: { redirectTo?: string };
    };

    expect(signInPayload.options?.redirectTo).toBeDefined();

    const redirectTo = new URL(signInPayload.options?.redirectTo ?? "", "https://lets-assist.test");
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("redirectAfterAuth")).toBe("/home?tab=calendar");
    expect(redirectTo.searchParams.get("staffToken")).toBe("abc-token");
    expect(redirectTo.searchParams.get("orgUsername")).toBe("troop941");
  });

  it("returns null inviteOutcome when invite context is missing", async () => {
    const result = await applyStaffInviteForCurrentUser(null, null);
    expect(result).toEqual({ inviteOutcome: null });
    expect(mocks.getAuthUser).not.toHaveBeenCalled();
  });

  it("applies invite for authenticated user after password login", async () => {
    mocks.getAuthUser.mockResolvedValue({
      user: { id: "user-123" },
      error: null,
    });
    mocks.applyStaffInviteForUser.mockResolvedValue({
      status: "success",
      orgUsername: "troop941",
      orgName: "Troop 941",
    });

    const result = await applyStaffInviteForCurrentUser("abc-token", "troop941");

    expect(mocks.getAuthUser).toHaveBeenCalledTimes(1);
    expect(mocks.applyStaffInviteForUser).toHaveBeenCalledWith({
      userId: "user-123",
      staffToken: "abc-token",
      orgUsername: "troop941",
    });
    expect(result).toEqual({
      inviteOutcome: {
        status: "success",
        orgUsername: "troop941",
        orgName: "Troop 941",
      },
    });
  });
});