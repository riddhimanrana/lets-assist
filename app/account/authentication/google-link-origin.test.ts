import { describe, expect, test } from "bun:test";

import { startGoogleIdentityLink } from "./google-link";

function fakeLocation(origin: string) {
  const assigned: string[] = [];
  const parsed = new URL(origin);
  return {
    assigned,
    location: {
      origin: parsed.origin,
      host: parsed.host,
      assign: (destination: string) => assigned.push(destination),
    },
  };
}

describe("startGoogleIdentityLink", () => {
  test("navigates a stale hosted alias to the canonical page before linkIdentity writes a verifier", async () => {
    const { assigned, location } = fakeLocation("https://stale.example");
    const providerCalls: unknown[] = [];
    const cookieWrites: string[] = [];
    const auth = {
      linkIdentity: async (options: unknown) => {
        providerCalls.push(options);
        cookieWrites.push(location.origin);
        return { error: null };
      },
    };

    const result = await startGoogleIdentityLink(auth, location, {
      publicSiteUrl: "https://lets-assist.com",
    });

    expect(result).toEqual({ redirected: true, error: null });
    expect(assigned).toEqual([
      "https://lets-assist.com/account/authentication",
    ]);
    expect(providerCalls).toHaveLength(0);
    expect(cookieWrites).toHaveLength(0);
  });

  test("calls linkIdentity only when its verifier cookie and callback share the canonical host", async () => {
    const { assigned, location } = fakeLocation("https://lets-assist.com");
    const providerCalls: Array<{
      options?: { redirectTo?: string };
    }> = [];
    const cookieWrites: string[] = [];
    const auth = {
      linkIdentity: async (options: { options?: { redirectTo?: string } }) => {
        providerCalls.push(options);
        cookieWrites.push(location.origin);
        return { error: null };
      },
    };

    const result = await startGoogleIdentityLink(auth, location, {
      publicSiteUrl: "https://lets-assist.com",
    });

    expect(result).toEqual({ redirected: false, error: null });
    expect(assigned).toHaveLength(0);
    expect(providerCalls).toHaveLength(1);
    const redirectTo = providerCalls[0]?.options?.redirectTo;
    expect(redirectTo).toBe(
      "https://lets-assist.com/auth/callback?from=authentication",
    );
    expect(new URL(redirectTo as string).origin).toBe(cookieWrites[0]);
  });

  test("keeps a same-port 127.0.0.1 browser and callback together", async () => {
    const { assigned, location } = fakeLocation("http://127.0.0.1:3012");
    let redirectTo = "";
    const auth = {
      linkIdentity: async (options: { options?: { redirectTo?: string } }) => {
        redirectTo = options.options?.redirectTo ?? "";
        return { error: null };
      },
    };

    const result = await startGoogleIdentityLink(auth, location, {
      publicSiteUrl: "http://localhost:3012",
    });

    expect(result.redirected).toBe(false);
    expect(assigned).toHaveLength(0);
    expect(new URL(redirectTo).origin).toBe("http://127.0.0.1:3012");
  });
});
