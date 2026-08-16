import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * Every redirect this handler emits is built on one base URL. That base URL
 * used to fall back to `request.nextUrl.origin` whenever
 * `NEXT_PUBLIC_SITE_URL` was unset or malformed, and `NextRequest#nextUrl`
 * is derived from the `x-forwarded-host`/`Host` headers -- so a
 * misconfigured deployment turned a request header into the destination an
 * authenticated browser was sent to, with the OAuth result in the query
 * string. It now uses `resolveAuthRedirectOrigin`, the same selection
 * `/auth/callback` and `/auth/confirm` use.
 *
 * These tests drive the real `GET` handler down its unauthenticated branch,
 * which is reached before any Google or Supabase work happens, and read the
 * `Location` header it actually produces.
 */

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: null },
        error: { message: "no session" },
      }),
      getClaims: async () => ({ data: null, error: null }),
    },
  }),
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("route-origin.test.ts: the admin client must not be used");
  },
}));

mock.module("@/lib/encryption", () => ({
  encrypt: () => {
    throw new Error("route-origin.test.ts: encryption must not be used");
  },
  decrypt: () => {
    throw new Error("route-origin.test.ts: decryption must not be used");
  },
}));

// An unauthenticated callback must be turned away before the durable ledger
// is touched, so neither claiming nor finalizing may run on this branch.
mock.module("@/lib/auth/google-oauth-attempt-store", () => ({
  claimGoogleOAuthAttempt: async () => {
    throw new Error(
      "route-origin.test.ts: the attempt ledger must not be read",
    );
  },
  finalizeGoogleOAuthAttempt: async () => {
    throw new Error(
      "route-origin.test.ts: the attempt ledger must not be written",
    );
  },
  markGoogleOAuthAttemptExchanged: async () => {
    throw new Error("route-origin.test.ts: no code exchange may be recorded");
  },
}));

mock.module("@/services/calendar", () => ({
  ensureOrganizationCalendar: async () => {
    throw new Error("route-origin.test.ts: calendar work must not be reached");
  },
}));

const { GET } = await import("./route");
const { NextRequest } = await import("next/server");

const HOSTED = "https://lets-assist.com";
const EVIL_HOST = "evil.example";

function request({
  host = "lets-assist.com",
  extraHeaders,
}: { host?: string | null; extraHeaders?: Record<string, string> } = {}) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new NextRequest(
    "http://internal-test/api/google/oauth/callback?code=abc123&state=xyz",
    { headers },
  );
}

function location(response: Response) {
  const raw = response.headers.get("location");
  expect(raw).not.toBeNull();
  return new URL(raw as string);
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  process.env.NEXT_PUBLIC_SITE_URL = HOSTED;
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("GET /api/google/oauth/callback (redirect origin)", () => {
  test("an unauthenticated callback redirects to the trusted origin, not the Host", async () => {
    try {
      const response = await GET(request({ host: EVIL_HOST }));
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/account/calendar");
      expect(url.searchParams.get("error")).toBe("unauthorized");
    } finally {
      restoreEnv();
    }
  });

  test("hostile forwarded headers cannot move the redirect off the trusted origin", async () => {
    try {
      const hostileHeaderSets: Array<Record<string, string>> = [
        { "x-forwarded-host": EVIL_HOST },
        { "x-forwarded-host": EVIL_HOST, "x-forwarded-proto": "http" },
        { origin: `https://${EVIL_HOST}` },
        { forwarded: `host=${EVIL_HOST};proto=http` },
      ];

      for (const extraHeaders of hostileHeaderSets) {
        const response = await GET(
          request({ host: "lets-assist.com", extraHeaders }),
        );
        const url = location(response);
        expect(url.origin).toBe(HOSTED);
        expect(url.hostname).not.toBe(EVIL_HOST);
      }
    } finally {
      restoreEnv();
    }
  });

  test("a malformed configured origin no longer falls back to the request host", async () => {
    // This is the regression: previously any unparseable
    // `NEXT_PUBLIC_SITE_URL` handed the redirect to `request.nextUrl.origin`.
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "not a url";
      const response = await GET(
        request({
          host: EVIL_HOST,
          extraHeaders: { "x-forwarded-host": EVIL_HOST },
        }),
      );
      const url = location(response);
      expect(url.hostname).not.toBe(EVIL_HOST);
      // No hosted signal is set, so this is a local process and the loopback
      // default applies -- an unreachable destination, but not the
      // attacker's.
      expect(url.origin).toBe("http://localhost:3000");
    } finally {
      restoreEnv();
    }
  });

  test("a hosted deployment with no usable configured origin fails instead of redirecting", async () => {
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_SITE_URL = "not a url";
      delete process.env.VERCEL_URL;
      await expect(GET(request({ host: EVIL_HOST }))).rejects.toThrow(
        /No valid site origin is configured/u,
      );
    } finally {
      restoreEnv();
    }
  });

  test("the loopback spelling the developer is on is preserved", async () => {
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
      const response = await GET(request({ host: "127.0.0.1:3012" }));
      expect(location(response).origin).toBe("http://127.0.0.1:3012");
    } finally {
      restoreEnv();
    }
  });
});
