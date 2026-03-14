import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let authStateChangeCallback:
    | ((event: string, session?: unknown) => void)
    | null = null;

  return {
    createClient: vi.fn(),
    unsubscribe: vi.fn(),
    setAuthStateChangeCallback: (callback: (event: string, session?: unknown) => void) => {
      authStateChangeCallback = callback;
    },
    getAuthStateChangeCallback: () => authStateChangeCallback,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import { AuthProvider } from "./AuthProvider";

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");

    mocks.createClient.mockReturnValue({
      auth: {
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
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs auth events without reading session.user", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    render(
      <AuthProvider>
        <div>ready</div>
      </AuthProvider>,
    );

    expect(screen.getByText("ready")).toBeInTheDocument();

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

    expect(() => callback?.("SIGNED_IN", unsafeSession)).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(
      "[AuthProvider] Auth state changed:",
      "SIGNED_IN",
    );

    logSpy.mockRestore();
  });
});