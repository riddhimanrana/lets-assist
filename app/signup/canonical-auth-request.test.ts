import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let requestHost = "lets-assist.com";
const redirects: string[] = [];

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`redirect:${destination}`);
  }
}

mock.module("next/headers", () => ({
  headers: async () => new Headers({ host: requestHost }),
}));

mock.module("next/navigation", () => ({
  redirect: (destination: string) => {
    redirects.push(destination);
    throw new RedirectSignal(destination);
  },
}));

const { runOnCanonicalAuthOrigin } = await import("./canonical-auth-request");

const originalEnv = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

beforeEach(() => {
  requestHost = "lets-assist.com";
  redirects.length = 0;
  process.env.NEXT_PUBLIC_SITE_URL = "https://lets-assist.com";
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("runOnCanonicalAuthOrigin", () => {
  test("Google login preserves invite and continuation context on canonical navigation", async () => {
    const loginActions = await Bun.file(
      new URL("../login/actions.ts", import.meta.url),
    ).text();

    expect(loginActions).toContain(
      "const canonicalLoginPath = loginParams.size",
    );
    expect(loginActions).toContain('loginParams.set("redirectAfterAuth"');
    expect(loginActions).toContain('loginParams.set("staffToken"');
    expect(loginActions).toContain('loginParams.set("orgUsername"');
    expect(loginActions).toContain(
      "runOnCanonicalAuthOrigin(canonicalLoginPath",
    );
  });

  test("redirects a non-canonical hosted browser before the provider can write a PKCE cookie", async () => {
    requestHost = "stale-alias.example";
    const providerCalls: string[] = [];
    const cookieWrites: string[] = [];

    await expect(
      runOnCanonicalAuthOrigin("/login", async (origin) => {
        providerCalls.push(origin);
        cookieWrites.push(requestHost);
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(redirects).toEqual(["https://lets-assist.com/login"]);
    expect(providerCalls).toHaveLength(0);
    expect(cookieWrites).toHaveLength(0);
  });

  test("runs the provider on the canonical hosted origin with matching cookie and callback hosts", async () => {
    const cookieWrites: string[] = [];

    const result = await runOnCanonicalAuthOrigin("/login", async (origin) => {
      cookieWrites.push(requestHost);
      return { redirectTo: `${origin}/auth/callback` };
    });

    expect(redirects).toHaveLength(0);
    expect(cookieWrites).toEqual(["lets-assist.com"]);
    expect(new URL(result.redirectTo).host).toBe(cookieWrites[0]);
  });

  test("preserves the loopback spelling that owns the verifier cookie", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
    requestHost = "127.0.0.1:3012";
    const cookieWrites: string[] = [];

    const result = await runOnCanonicalAuthOrigin("/signup", async (origin) => {
      cookieWrites.push(requestHost);
      return { redirectTo: `${origin}/auth/confirm` };
    });

    expect(redirects).toHaveLength(0);
    expect(cookieWrites).toEqual(["127.0.0.1:3012"]);
    expect(new URL(result.redirectTo).host).toBe(cookieWrites[0]);
    expect(new URL(result.redirectTo).origin).toBe("http://127.0.0.1:3012");
  });

  test("redirects a mismatched loopback port before the provider runs", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
    requestHost = "127.0.0.1:9999";
    let providerCalled = false;

    await expect(
      runOnCanonicalAuthOrigin("/reset-password", async () => {
        providerCalled = true;
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(redirects).toEqual(["http://localhost:3012/reset-password"]);
    expect(providerCalled).toBe(false);
  });
});
