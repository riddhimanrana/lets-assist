import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let authStateChangeCallback:
    | ((event: string, session?: unknown) => void)
    | null = null;

  return {
    createClient: vi.fn(),
    getClaims: vi.fn(),
    getUser: vi.fn(),
    listFactors: vi.fn(),
    unsubscribe: vi.fn(),
    deriveAuthenticatorAssurance: vi.fn(),
    shouldPromptForMfaChallenge: vi.fn(),
    setAuthStateChangeCallback: (callback: (event: string, session?: unknown) => void) => {
      authStateChangeCallback = callback;
    },
    getAuthStateChangeCallback: () => authStateChangeCallback,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/auth/mfa", () => ({
  deriveAuthenticatorAssurance: mocks.deriveAuthenticatorAssurance,
  shouldPromptForMfaChallenge: mocks.shouldPromptForMfaChallenge,
}));

import { useAuth, useAuthRefresh } from "./useAuth";

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.deriveAuthenticatorAssurance.mockReturnValue({
      currentLevel: "aal1",
      nextLevel: "aal1",
    });
    mocks.shouldPromptForMfaChallenge.mockReturnValue(false);

    mocks.createClient.mockReturnValue({
      auth: {
        getClaims: mocks.getClaims,
        getUser: mocks.getUser,
        onAuthStateChange: (callback: (event: string, session?: unknown) => void) => {
          mocks.setAuthStateChangeCallback(callback);

          return {
            data: {
              subscription: {
                unsubscribe: mocks.unsubscribe,
              },
            },
          };
        },
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
          role: "authenticated",
          user_metadata: { full_name: "Volunteer Example" },
          app_metadata: { provider: "email" },
        },
      },
      error: null,
    });

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "fresh-user-123",
          email: "fresh@example.com",
        },
      },
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

  it("refreshes auth state from claims instead of reading the session user from auth events", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe("user-123");
    expect(result.current.user?.email).toBe("volunteer@example.com");
    expect(result.current.isAuthenticated).toBe(true);

    const callback = mocks.getAuthStateChangeCallback();
    const unsafeSession = {
      user: new Proxy(
        {},
        {
          get() {
            throw new Error("session.user should not be accessed");
          },
        },
      ),
    };

    expect(() => {
      act(() => {
        callback?.("SIGNED_IN", unsafeSession);
      });
    }).not.toThrow();

    await waitFor(() => expect(mocks.getClaims).toHaveBeenCalledTimes(2));
    expect(result.current.user?.id).toBe("user-123");
  });

  it("clears the user on sign out without touching the session payload", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user?.id).toBe("user-123"));

    const callback = mocks.getAuthStateChangeCallback();
    const unsafeSession = {
      user: new Proxy(
        {},
        {
          get() {
            throw new Error("session.user should not be accessed");
          },
        },
      ),
    };

    expect(() => {
      act(() => {
        callback?.("SIGNED_OUT", unsafeSession);
      });
    }).not.toThrow();

    expect(result.current.user).toBeNull();
    expect(result.current.needsMfa).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe("useAuthRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.createClient.mockReturnValue({
      auth: {
        getUser: mocks.getUser,
      },
    });

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "fresh-user-123",
          email: "fresh@example.com",
        },
      },
      error: null,
    });
  });

  it("uses getUser when an explicit trusted refresh is requested", async () => {
    const { result } = renderHook(() => useAuthRefresh());

    await expect(result.current()).resolves.toEqual({
      id: "fresh-user-123",
      email: "fresh@example.com",
    });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});