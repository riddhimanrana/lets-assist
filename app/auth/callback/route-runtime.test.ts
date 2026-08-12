import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * `route-origin.test.ts` in this directory only proves the *source* routes
 * every redirect through `authOrigin`. That leaves the actual handler
 * unexecuted: it would not catch a callback branch that builds a redirect
 * from something other than `authOrigin`, or one that never runs the
 * `resolveAuthRedirectOrigin` call at all. This file actually invokes `GET`
 * with every Supabase-backed dependency stubbed out, and reads the real
 * `Location` header the handler produces.
 *
 * All Supabase clients are replaced with in-memory stand-ins driven by the
 * mutable `state` object below, reset in `beforeEach`. No network, no real
 * database, no real Supabase project.
 */

type QueryResult = { data?: unknown; error?: unknown };

function chain(result: QueryResult) {
  const builder: {
    eq: () => typeof builder;
    single: () => Promise<QueryResult>;
    maybeSingle: () => Promise<QueryResult>;
    then: (resolve: (value: QueryResult) => void) => void;
  } = {
    eq: () => builder,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return builder;
}

function table(config: {
  select?: QueryResult;
  insert?: QueryResult;
  update?: QueryResult;
}) {
  return {
    select: () => chain(config.select ?? { data: null, error: null }),
    insert: () => Promise.resolve(config.insert ?? { error: null }),
    update: () => chain(config.update ?? { error: null }),
  };
}

type ExchangeError = {
  message?: string;
  name?: string;
  status?: number;
} | null;

const state: {
  exchangeError: ExchangeError;
  user: Record<string, unknown> | null;
  userError: unknown;
  existingProfile: Record<string, unknown> | null;
  claimsAal: string | null;
  totpFactors: Array<{
    id: string;
    factor_type: string;
    status: string;
    created_at: string;
  }>;
  banned: boolean;
} = {
  exchangeError: null,
  user: null,
  userError: null,
  existingProfile: { id: "existing" },
  claimsAal: null,
  totpFactors: [],
  banned: false,
};

function resetState() {
  state.exchangeError = null;
  state.user = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    email: "runtime-callback@local.test",
    created_at: "2020-01-01T00:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
    identities: [{ provider: "google" }],
  };
  state.userError = null;
  state.existingProfile = { id: "aaaaaaaa-0000-4000-8000-000000000001" };
  state.claimsAal = null;
  state.totpFactors = [];
  state.banned = false;
}

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => {
        if (state.exchangeError) {
          return { error: state.exchangeError };
        }
        return { error: null };
      },
      getUser: async () => ({
        data: { user: state.user },
        error: state.userError,
      }),
      signOut: async () => ({ error: null }),
      getClaims: async () => ({
        data: state.claimsAal
          ? { claims: { aal: state.claimsAal } }
          : { claims: {} },
        error: null,
      }),
      mfa: {
        listFactors: async () => ({
          data: { totp: state.totpFactors, phone: [] },
          error: null,
        }),
      },
      updateUser: async () => ({ error: null }),
    },
    from: (tableName: string) => {
      if (tableName === "profiles") {
        return table({
          select: { data: state.existingProfile, error: null },
          insert: { error: null },
          update: { error: null },
        });
      }
      throw new Error(`route-runtime.test.ts: unexpected table "${tableName}"`);
    },
  }),
}));

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (tableName: string) => {
      if (tableName === "banned_emails") {
        return table({
          select: { data: state.banned ? { email: "banned" } : null, error: null },
        });
      }
      throw new Error(`route-runtime.test.ts: unexpected admin table "${tableName}"`);
    },
  }),
}));

mock.module("@/lib/security/google-cap", () => ({
  getGoogleSigninCapRestriction: () => ({ disabled: false, reason: null }),
}));

mock.module("@/lib/organization/verified-domain-affiliation", () => ({
  applyVerifiedDomainAffiliation: async () => {},
}));

mock.module("@/lib/organization/staff-invite", () => ({
  applyStaffInviteForUser: async () => ({ status: "org_not_found" }),
}));

const { GET } = await import("./route");

const HOSTED = "https://lets-assist.com";
const EVIL_HOST = "evil.example";

function request(
  path: string,
  {
    host = "lets-assist.com",
    extraHeaders,
  }: {
    host?: string | null;
    extraHeaders?: Record<string, string>;
  } = {},
) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Request(`http://internal-test${path}`, { headers });
}

function location(response: Response) {
  const raw = response.headers.get("location");
  expect(raw).not.toBeNull();
  return new URL(raw as string);
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  resetState();
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

describe("GET /auth/callback (runtime)", () => {
  test("recovery: redirects to the trusted origin's reset-password page, never the evil Host", async () => {
    try {
      const response = await GET(
        request("/auth/callback?code=abc123&type=recovery", {
          host: EVIL_HOST,
        }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/reset-password/abc123");
    } finally {
      restoreEnv();
    }
  });

  test("OAuth error: redirects to /error on the trusted origin with the message preserved", async () => {
    try {
      const response = await GET(
        request(
          "/auth/callback?error=access_denied&error_description=User%20denied%20access",
          { host: EVIL_HOST },
        ),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/error");
      expect(url.searchParams.get("message")).toBe("User denied access");
      expect(url.searchParams.get("code")).toBe("access_denied");
    } finally {
      restoreEnv();
    }
  });

  test("OAuth error: an existing-email-password error redirects to /login on the trusted origin", async () => {
    try {
      const response = await GET(
        request(
          "/auth/callback?error=identity_already_exists&error_description=email%20already%20exists",
          { host: EVIL_HOST },
        ),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("error")).toBe("email-password-exists");
    } finally {
      restoreEnv();
    }
  });

  test("retry exhaustion: a persistently retryable exchange failure redirects to /login?error=network-timeout on the trusted origin", async () => {
    try {
      state.exchangeError = {
        name: "AuthRetryableFetchError",
        message: "network error",
        status: 0,
      };
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("error")).toBe("network-timeout");
    } finally {
      restoreEnv();
    }
  }, 10_000);

  test("retry exhaustion: a non-retryable exchange failure redirects to /error on the trusted origin", async () => {
    try {
      state.exchangeError = { message: "invalid grant" };
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/error");
    } finally {
      restoreEnv();
    }
  });

  test("MFA: a user with a verified TOTP factor and no aal2 session is redirected to /auth/mfa on the trusted origin", async () => {
    try {
      state.claimsAal = "aal1";
      state.totpFactors = [
        {
          id: "factor-1",
          factor_type: "totp",
          status: "verified",
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ];
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/auth/mfa");
    } finally {
      restoreEnv();
    }
  });

  test("final redirect: a fully authenticated user with no MFA requirement lands on /home on the trusted origin", async () => {
    try {
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/home");
    } finally {
      restoreEnv();
    }
  });

  test("banned account: signs out and redirects to /login?error=account-banned on the trusted origin", async () => {
    try {
      state.banned = true;
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/login");
      expect(url.searchParams.get("error")).toBe("account-banned");
    } finally {
      restoreEnv();
    }
  });

  test("fallback: no code and no error still redirects to /error on the trusted origin, never the evil Host", async () => {
    try {
      const response = await GET(request("/auth/callback", { host: EVIL_HOST }));
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/error");
    } finally {
      restoreEnv();
    }
  });

  test("every redirect across these scenarios stays on the trusted origin for a spoofed Host, never on evil.example", async () => {
    try {
      const responses = await Promise.all([
        GET(request("/auth/callback?code=x&type=recovery", { host: EVIL_HOST })),
        GET(request("/auth/callback?error=e", { host: EVIL_HOST })),
        GET(request("/auth/callback", { host: EVIL_HOST })),
      ]);
      for (const response of responses) {
        const url = location(response);
        expect(url.hostname).not.toBe(EVIL_HOST);
        expect(url.origin).toBe(HOSTED);
      }
    } finally {
      restoreEnv();
    }
  });

  test("loopback dev: the confirming loopback spelling is preserved, not lost to the server's own binding", async () => {
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
      const response = await GET(
        request("/auth/callback?code=abc123", { host: "127.0.0.1:3012" }),
      );
      const url = location(response);
      expect(url.origin).toBe("http://127.0.0.1:3012");
      expect(url.pathname).toBe("/home");
    } finally {
      restoreEnv();
    }
  });

  test("loopback dev: a mismatched port Host is refused and the configured loopback origin is kept", async () => {
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
      const response = await GET(
        request("/auth/callback", { host: "127.0.0.1:9999" }),
      );
      const url = location(response);
      expect(url.origin).toBe("http://localhost:3012");
    } finally {
      restoreEnv();
    }
  });

  test("a missing Host header still resolves to the trusted configured origin", async () => {
    try {
      const response = await GET(request("/auth/callback", { host: null }));
      const url = location(response);
      expect(url.origin).toBe(HOSTED);
    } finally {
      restoreEnv();
    }
  });
});

/**
 * The header combinations a proxy-aware attacker actually reaches for. None
 * of these may move a redirect off the configured origin: the handler reads
 * only `Host`, and the resolver ignores even that on a hosted deployment.
 * `x-forwarded-host` matters specifically because `NextRequest#nextUrl` is
 * built from it -- any handler that derived its origin from `nextUrl` would
 * follow these headers straight to the attacker's host.
 */
describe("GET /auth/callback (hostile forwarded host and origin headers)", () => {
  const HOSTILE_HEADER_SETS: Array<{
    name: string;
    host: string | null;
    extraHeaders: Record<string, string>;
  }> = [
    {
      name: "x-forwarded-host alone",
      host: null,
      extraHeaders: { "x-forwarded-host": EVIL_HOST },
    },
    {
      name: "x-forwarded-host overriding a legitimate Host",
      host: "lets-assist.com",
      extraHeaders: { "x-forwarded-host": EVIL_HOST },
    },
    {
      name: "x-forwarded-host and x-forwarded-proto together",
      host: EVIL_HOST,
      extraHeaders: {
        "x-forwarded-host": EVIL_HOST,
        "x-forwarded-proto": "http",
      },
    },
    {
      name: "a hostile Origin header",
      host: "lets-assist.com",
      extraHeaders: { origin: `https://${EVIL_HOST}` },
    },
    {
      name: "a hostile Referer header",
      host: "lets-assist.com",
      extraHeaders: { referer: `https://${EVIL_HOST}/attack` },
    },
    {
      name: "x-forwarded-server and forwarded",
      host: EVIL_HOST,
      extraHeaders: {
        "x-forwarded-server": EVIL_HOST,
        forwarded: `host=${EVIL_HOST};proto=http`,
      },
    },
    {
      name: "a Host carrying an appended proxy list",
      host: `lets-assist.com, ${EVIL_HOST}`,
      extraHeaders: {},
    },
    {
      name: "a Host carrying userinfo",
      host: `lets-assist.com@${EVIL_HOST}`,
      extraHeaders: {},
    },
    {
      name: "a Host on a non-canonical port",
      host: "lets-assist.com:8443",
      extraHeaders: {},
    },
    {
      name: "a Host that is an IP literal",
      host: "203.0.113.10",
      extraHeaders: {},
    },
    {
      name: "an empty Host",
      host: "",
      extraHeaders: {},
    },
  ];

  for (const { name, host, extraHeaders } of HOSTILE_HEADER_SETS) {
    test(`${name} cannot move the redirect off the configured origin`, async () => {
      try {
        const response = await GET(
          request("/auth/callback?code=abc123", { host, extraHeaders }),
        );
        const url = location(response);
        expect(url.origin).toBe(HOSTED);
        expect(url.hostname).not.toBe(EVIL_HOST);
        expect(url.pathname).toBe("/home");
      } finally {
        restoreEnv();
      }
    });
  }
});

/**
 * Hosted deployments are pinned to the configured origin in every
 * environment shape, and a hosted deployment whose configuration cannot
 * produce a valid origin fails the request rather than redirecting anywhere
 * -- least of all to the `Host` the attacker supplied.
 */
describe("GET /auth/callback (hosted environments and fail-closed configuration)", () => {
  test("a trusted hosted Production origin is used regardless of the Host", async () => {
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_SITE_URL = HOSTED;
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      expect(location(response).origin).toBe(HOSTED);
    } finally {
      restoreEnv();
    }
  });

  test("a trusted hosted Development preview origin is used regardless of the Host", async () => {
    const DEVELOPMENT = "https://development.lets-assist.com";
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SITE_URL = DEVELOPMENT;
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      expect(location(response).origin).toBe(DEVELOPMENT);
    } finally {
      restoreEnv();
    }
  });

  test("a platform-issued VERCEL_URL is used when NEXT_PUBLIC_SITE_URL is malformed", async () => {
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SITE_URL = "not a url";
      process.env.VERCEL_URL = "branch-abc123.vercel.app";
      const response = await GET(
        request("/auth/callback?code=abc123", { host: EVIL_HOST }),
      );
      expect(location(response).origin).toBe("https://branch-abc123.vercel.app");
    } finally {
      restoreEnv();
    }
  });

  test("a hosted deployment with no usable configured origin fails the request instead of redirecting", async () => {
    for (const malformed of [
      undefined,
      "not a url",
      "javascript:alert(1)",
      `${HOSTED}/path`,
      `${HOSTED}?redirect=evil`,
      "https://user:pass@lets-assist.com",
    ]) {
      try {
        process.env.VERCEL = "1";
        process.env.VERCEL_ENV = "production";
        delete process.env.VERCEL_URL;
        if (malformed === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
        else process.env.NEXT_PUBLIC_SITE_URL = malformed;

        // No Location header is produced at all: the handler raises before
        // it can build one, so there is no redirect for the spoofed Host to
        // capture.
        await expect(
          GET(request("/auth/callback?code=abc123", { host: EVIL_HOST })),
        ).rejects.toThrow(/No valid site origin is configured/u);
      } finally {
        restoreEnv();
      }
    }
  });
});

/**
 * The loopback carve-out is the one place the request's own host is
 * honored, and only for the exact same loopback service. It exists because
 * `127.0.0.1` and `localhost` are separate cookie origins, so a redirect to
 * the wrong spelling strands the PKCE verifier -- the regression this whole
 * module was written for.
 */
describe("GET /auth/callback (loopback development carve-out)", () => {
  const LOOPBACK_CASES: Array<{
    name: string;
    configured: string;
    host: string;
    expected: string;
  }> = [
    {
      name: "127.0.0.1 confirming a localhost-configured stack",
      configured: "http://localhost:3012",
      host: "127.0.0.1:3012",
      expected: "http://127.0.0.1:3012",
    },
    {
      name: "localhost confirming a 127.0.0.1-configured stack",
      configured: "http://127.0.0.1:3012",
      host: "localhost:3012",
      expected: "http://localhost:3012",
    },
    {
      name: "the IPv6 loopback literal",
      configured: "http://localhost:3012",
      host: "[::1]:3012",
      expected: "http://[::1]:3012",
    },
    {
      name: "the same spelling it was configured with",
      configured: "http://localhost:3012",
      host: "localhost:3012",
      expected: "http://localhost:3012",
    },
    {
      name: "a mismatched loopback port is refused",
      configured: "http://localhost:3012",
      host: "127.0.0.1:9999",
      expected: "http://localhost:3012",
    },
    {
      name: "a non-loopback Host is refused even on a loopback stack",
      configured: "http://localhost:3012",
      host: EVIL_HOST,
      expected: "http://localhost:3012",
    },
    {
      name: "a loopback-looking but non-loopback Host is refused",
      configured: "http://localhost:3012",
      host: "localhost.evil.example:3012",
      expected: "http://localhost:3012",
    },
  ];

  for (const { name, configured, host, expected } of LOOPBACK_CASES) {
    test(`${name}`, async () => {
      try {
        process.env.NEXT_PUBLIC_SITE_URL = configured;
        const response = await GET(
          request("/auth/callback?code=abc123", { host }),
        );
        const url = location(response);
        expect(url.origin).toBe(expected);
        expect(url.pathname).toBe("/home");
      } finally {
        restoreEnv();
      }
    });
  }

  test("a loopback deployment never honors a hostile x-forwarded-host either", async () => {
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
      const response = await GET(
        request("/auth/callback?code=abc123", {
          host: "127.0.0.1:3012",
          extraHeaders: { "x-forwarded-host": EVIL_HOST },
        }),
      );
      expect(location(response).origin).toBe("http://127.0.0.1:3012");
    } finally {
      restoreEnv();
    }
  });
});
