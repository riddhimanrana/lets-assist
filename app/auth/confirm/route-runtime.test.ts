import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

/**
 * `/auth/confirm` is the destination of every emailed confirmation link, so
 * its redirect origin decides which cookie origin ends up holding the
 * verified session. It resolves that origin through
 * `resolveAuthRedirectOrigin` rather than `new URL(request.url)` -- Next.js
 * rebuilds `request.url` from the server's own binding, so on the loopback
 * stack it reads `http://localhost:<port>` no matter which loopback
 * spelling the browser actually used.
 *
 * This drives the real `GET` handler and reads the URL it redirects to.
 * `redirect()` from `next/navigation` throws a control-flow error rather
 * than returning, so it is replaced with a stand-in that records the
 * destination and throws a recognizable marker.
 */

const redirects: string[] = [];

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`redirect:${destination}`);
    this.name = "RedirectSignal";
  }
}

mock.module("next/navigation", () => ({
  redirect: (destination: string) => {
    redirects.push(destination);
    throw new RedirectSignal(destination);
  },
}));

const state: {
  exchangeError: { message?: string; code?: string } | null;
  verifyError: { message?: string } | null;
  user: { id: string; email: string } | null;
} = {
  exchangeError: null,
  verifyError: null,
  user: null,
};

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      verifyOtp: async () => ({ error: state.verifyError }),
      getUser: async () => ({ data: { user: state.user }, error: null }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

mock.module("@/lib/auth/primary-email", () => ({
  syncPrimaryUserEmail: async () => ({ success: true, status: "synced" }),
}));

const { GET } = await import("./route");

const HOSTED = "https://lets-assist.com";
const EVIL_HOST = "evil.example";

function request(
  path: string,
  {
    host = "lets-assist.com",
    extraHeaders,
  }: { host?: string | null; extraHeaders?: Record<string, string> } = {},
) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  // `NextRequest` is not needed: the handler reads `request.url`,
  // `request.headers`, and nothing else off the request.
  return new Request(`http://internal-test${path}`, {
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

/** Runs `GET` and returns the URL it redirected to. */
async function redirectedTo(...args: Parameters<typeof request>) {
  redirects.length = 0;
  await expect(GET(request(...args))).rejects.toBeInstanceOf(RedirectSignal);
  expect(redirects).toHaveLength(1);
  return redirects[0];
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  state.exchangeError = null;
  state.verifyError = null;
  state.user = { id: "user-1", email: "confirm@local.test" };
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

describe("GET /auth/confirm (runtime)", () => {
  test("a signup code exchange lands on the trusted origin, never the spoofed Host", async () => {
    try {
      const destination = await redirectedTo("/auth/confirm?code=abc123", {
        host: EVIL_HOST,
      });
      const url = new URL(destination);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/auth/verification-success");
      expect(url.searchParams.get("type")).toBe("signup");
      expect(url.searchParams.get("email")).toBe("confirm@local.test");
    } finally {
      restoreEnv();
    }
  });

  test("a token_hash verification lands on the trusted origin", async () => {
    try {
      const destination = await redirectedTo(
        "/auth/confirm?token_hash=hash-1&type=signup",
        { host: EVIL_HOST },
      );
      expect(new URL(destination).origin).toBe(HOSTED);
    } finally {
      restoreEnv();
    }
  });

  test("an email_change confirmation lands on the trusted origin", async () => {
    try {
      const destination = await redirectedTo(
        "/auth/confirm?token_hash=hash-1&type=email_change",
        { host: EVIL_HOST },
      );
      const url = new URL(destination);
      expect(url.origin).toBe(HOSTED);
      expect(url.searchParams.get("type")).toBe("email_change");
    } finally {
      restoreEnv();
    }
  });

  test("an expired signup link lands on the trusted origin's expiry page", async () => {
    try {
      state.exchangeError = { message: "Token has expired" };
      const destination = await redirectedTo(
        "/auth/confirm?code=abc123&type=signup&email=confirm%40local.test",
        { host: EVIL_HOST },
      );
      const url = new URL(destination);
      expect(url.origin).toBe(HOSTED);
      expect(url.pathname).toBe("/auth/email-expired");
      expect(url.searchParams.get("email")).toBe("confirm@local.test");
    } finally {
      restoreEnv();
    }
  });

  test("a missing PKCE verifier lands on the trusted origin's expiry page", async () => {
    try {
      state.exchangeError = {
        message: "PKCE code verifier not found",
        code: "pkce_code_verifier_not_found",
      };
      const destination = await redirectedTo("/auth/confirm?code=abc123", {
        host: EVIL_HOST,
      });
      expect(new URL(destination).origin).toBe(HOSTED);
    } finally {
      restoreEnv();
    }
  });

  test("hostile forwarded headers cannot move the confirmation off the trusted origin", async () => {
    try {
      const hostileHeaderSets: Array<Record<string, string>> = [
        { "x-forwarded-host": EVIL_HOST },
        { "x-forwarded-host": EVIL_HOST, "x-forwarded-proto": "http" },
        { origin: `https://${EVIL_HOST}` },
        { forwarded: `host=${EVIL_HOST}` },
      ];

      for (const extraHeaders of hostileHeaderSets) {
        const destination = await redirectedTo("/auth/confirm?code=abc123", {
          host: "lets-assist.com",
          extraHeaders,
        });
        const url = new URL(destination);
        expect(url.origin).toBe(HOSTED);
        expect(url.hostname).not.toBe(EVIL_HOST);
      }
    } finally {
      restoreEnv();
    }
  });

  test("the loopback spelling the browser confirmed on is preserved", async () => {
    try {
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3012";
      const destination = await redirectedTo("/auth/confirm?code=abc123", {
        host: "127.0.0.1:3012",
      });
      expect(new URL(destination).origin).toBe("http://127.0.0.1:3012");
    } finally {
      restoreEnv();
    }
  });

  test("a hosted deployment with no usable configured origin fails the request", async () => {
    try {
      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "production";
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.VERCEL_URL;
      redirects.length = 0;
      await expect(
        GET(request("/auth/confirm?code=abc123", { host: EVIL_HOST })),
      ).rejects.toThrow(/No valid site origin is configured/u);
      // It failed before producing any destination at all.
      expect(redirects).toHaveLength(0);
    } finally {
      restoreEnv();
    }
  });
});
