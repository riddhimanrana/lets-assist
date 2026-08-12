import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let stateCreated = false;

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", email: "user@local.test" } },
        error: null,
      }),
    },
  }),
}));

mock.module("@/lib/auth/google-oauth-state", () => ({
  GOOGLE_OAUTH_STATE_COOKIE_NAME: "google_oauth_state",
  getGoogleOAuthStateCookieOptions: () => ({ path: "/" }),
  normalizeGoogleOAuthReturnTo: (value: string | null) =>
    value?.startsWith("/") && !value.startsWith("//") ? value : null,
  createGoogleOAuthState: () => {
    stateCreated = true;
    throw new Error("OAuth state must not be created for a denied request");
  },
}));

mock.module("@/lib/auth/google-oauth-authorization", () => ({
  resolveGoogleOAuthRequestIntent: () => ({
    ok: true,
    intent: {
      organizationId: "org-1",
      pluginKey: "test-plugin",
      purpose: "organization_calendar",
      requestedCapability: "calendar.write",
    },
  }),
  authorizeGoogleOAuthOrganizationRequest: async () => ({
    allowed: false,
    reason: "not_member",
  }),
  googleOAuthAuthorizationError: () => "organization_access_denied",
  getGoogleOAuthRequiredScopeFamily: () => "calendar",
}));

mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: async () => {
    throw new Error("connection lookup must not run for a denied request");
  },
}));

const { GET } = await import("./route");

const originalEnv = {
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

beforeEach(() => {
  stateCreated = false;
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

function deniedRequest(host: string) {
  return new Request(
    "http://internal-test/api/calendar/google/connect?organization_id=org-1&return_to=%2Faccount%2Fcalendar",
    { headers: { host, "x-forwarded-host": "evil.example" } },
  );
}

describe("GET /api/calendar/google/connect denied redirect", () => {
  test("uses the trusted configured origin instead of request URL or proxy headers", async () => {
    const response = await GET(deniedRequest("evil.example"));
    const location = new URL(response.headers.get("location") as string);

    expect(location.origin).toBe("https://lets-assist.com");
    expect(location.pathname).toBe("/account/calendar");
    expect(location.searchParams.get("error")).toBe(
      "organization_access_denied",
    );
    expect(stateCreated).toBe(false);
  });

  test("preserves the browser's same-port loopback spelling", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
    const response = await GET(deniedRequest("127.0.0.1:3012"));
    expect(new URL(response.headers.get("location") as string).origin).toBe(
      "http://127.0.0.1:3012",
    );
  });

  test("fails closed when hosted configuration has no trusted origin", async () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;

    const response = await GET(deniedRequest("evil.example"));
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
    expect(stateCreated).toBe(false);
  });
});
