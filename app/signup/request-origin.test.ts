import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildAuthConfirmRedirectUrl } from "./redirect-utils";
import {
  isLoopbackHostname,
  resolveAuthRedirectOrigin,
  resolveAuthRequestOrigin,
  resolveClientAuthOrigin,
  resolveConfiguredSiteOrigin,
} from "./request-origin";

const LOCAL = "http://localhost:3012";
const LOOPBACK_IP = "http://127.0.0.1:3012";
const HOSTED = "https://lets-assist.com";

test("keeps the loopback spelling the developer actually opened", () => {
  // The verifier cookie is written for the request origin, so the emailed link
  // has to come back to that same spelling.
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: LOCAL,
      requestHost: "127.0.0.1:3012",
    }),
    LOOPBACK_IP,
  );
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: LOOPBACK_IP,
      requestHost: "localhost:3012",
    }),
    LOCAL,
  );
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: LOCAL,
      requestHost: "localhost:3012",
    }),
    LOCAL,
  );
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: LOCAL,
      requestHost: "[::1]:3012",
    }),
    "http://[::1]:3012",
  );
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: "http://localhost",
      requestHost: "127.0.0.1",
    }),
    "http://127.0.0.1",
  );
});

test("refuses a loopback host on a different port", () => {
  // A different port is a different origin and a different cookie jar.
  for (const requestHost of ["127.0.0.1:3013", "localhost:3000", "127.0.0.1"]) {
    assert.equal(
      resolveAuthRequestOrigin({ configuredOrigin: LOCAL, requestHost }),
      LOCAL,
    );
  }
});

test("refuses any host that is not the configured loopback service", () => {
  for (const requestHost of [
    "evil.example",
    "evil.example:3012",
    "localhost.evil.example:3012",
    "127.0.0.1.evil.example:3012",
    "127.0.0.1:3012, evil.example",
    "user@127.0.0.1:3012",
    "127.0.0.1:3012/path",
    "127.0.0.1:3012\nX-Injected: 1",
    "0.0.0.0:3012",
    "192.168.1.20:3012",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(
      resolveAuthRequestOrigin({ configuredOrigin: LOCAL, requestHost }),
      LOCAL,
    );
  }
});

test("hosted deployments always keep the trusted configured origin", () => {
  for (const requestHost of [
    "127.0.0.1:3012",
    "localhost:3012",
    "attacker.example",
    "lets-assist.com",
    null,
  ]) {
    assert.equal(
      resolveAuthRequestOrigin({ configuredOrigin: HOSTED, requestHost }),
      HOSTED,
    );
  }
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: "https://dev.lets-assist.com",
      requestHost: "127.0.0.1:3012",
    }),
    "https://dev.lets-assist.com",
  );
});

test("an unparseable configured origin is never replaced by the request host", () => {
  assert.equal(
    resolveAuthRequestOrigin({
      configuredOrigin: "not-a-url",
      requestHost: "127.0.0.1:3012",
    }),
    "not-a-url",
  );
});

test("recognizes only real loopback hostnames", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("LOCALHOST"), true);
  assert.equal(isLoopbackHostname("localhost.evil.example"), false);
  assert.equal(isLoopbackHostname("127.0.0.2"), false);
  assert.equal(isLoopbackHostname(null), false);
});

test("the configured origin comes from configuration only", () => {
  assert.equal(
    resolveConfiguredSiteOrigin({ NEXT_PUBLIC_SITE_URL: `${LOCAL}/` }),
    LOCAL,
  );
  assert.equal(
    resolveConfiguredSiteOrigin({ NEXT_PUBLIC_SITE_URL: "  " }),
    "http://localhost:3000",
  );
  assert.equal(resolveConfiguredSiteOrigin({}), "http://localhost:3000");
  assert.equal(
    resolveConfiguredSiteOrigin({ VERCEL_URL: "preview.vercel.app" }),
    "https://preview.vercel.app",
  );
  // Explicit configuration always outranks the platform-supplied host.
  assert.equal(
    resolveConfiguredSiteOrigin({
      NEXT_PUBLIC_SITE_URL: HOSTED,
      VERCEL_URL: "preview.vercel.app",
    }),
    HOSTED,
  );
});

test("a malformed configured site URL is treated as absent, not returned unchanged", () => {
  // Non-hosted (no Vercel signal): falls through to the loopback default,
  // same as an unset or blank NEXT_PUBLIC_SITE_URL.
  for (const malformed of [
    "not a url",
    "javascript:alert(1)",
    "ftp://lets-assist.com",
    `${HOSTED}/some/path`,
    `${HOSTED}?redirect=evil`,
    `${HOSTED}#fragment`,
    "https://user:pass@lets-assist.com",
    "https://lets-assist.com:notaport",
  ]) {
    assert.equal(
      resolveConfiguredSiteOrigin({ NEXT_PUBLIC_SITE_URL: malformed }),
      "http://localhost:3000",
    );
  }
});

test("a malformed configured site URL falls back to a valid VERCEL_URL on a hosted deployment", () => {
  assert.equal(
    resolveConfiguredSiteOrigin({
      VERCEL: "1",
      NEXT_PUBLIC_SITE_URL: "not a url",
      VERCEL_URL: "my-branch-abc123.vercel.app",
    }),
    "https://my-branch-abc123.vercel.app",
  );
});

test("a hosted deployment never falls back to a loopback origin -- it throws instead", () => {
  for (const env of [
    { VERCEL: "1" },
    { VERCEL_ENV: "production" },
    { VERCEL_ENV: "preview" },
    { VERCEL: "1", NEXT_PUBLIC_SITE_URL: "not a url" },
    { VERCEL: "1", NEXT_PUBLIC_SITE_URL: `${HOSTED}/some/path` },
    { VERCEL: "1", VERCEL_URL: "bad url with spaces" },
    { VERCEL: "1", NEXT_PUBLIC_SITE_URL: "https://user:pass@lets-assist.com" },
  ]) {
    assert.throws(() => resolveConfiguredSiteOrigin(env));
  }
});

test("a non-hosted process keeps the loopback default with no Vercel signal at all", () => {
  assert.equal(resolveConfiguredSiteOrigin({}), "http://localhost:3000");
  assert.equal(
    resolveConfiguredSiteOrigin({ NEXT_PUBLIC_SITE_URL: "not a url" }),
    "http://localhost:3000",
  );
});

test("a valid configured site URL is trusted even when VERCEL signals are also present", () => {
  assert.equal(
    resolveConfiguredSiteOrigin({ VERCEL: "1", NEXT_PUBLIC_SITE_URL: HOSTED }),
    HOSTED,
  );
  assert.equal(
    resolveConfiguredSiteOrigin({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: `${HOSTED}/`,
    }),
    HOSTED,
  );
});

test("the auth redirect origin keeps the confirming loopback spelling", () => {
  // The regression: the browser confirms on 127.0.0.1 while the stack is
  // configured for localhost, so the post-exchange hops must stay on
  // 127.0.0.1 -- that is the cookie origin the PKCE verifier was written to.
  assert.equal(
    resolveAuthRedirectOrigin("127.0.0.1:3012", {
      NEXT_PUBLIC_SITE_URL: LOCAL,
    }),
    LOOPBACK_IP,
  );
  assert.equal(
    resolveAuthRedirectOrigin("localhost:3012", {
      NEXT_PUBLIC_SITE_URL: LOCAL,
    }),
    LOCAL,
  );
});

test("the auth redirect origin ignores a spoofed Host off loopback", () => {
  for (const requestHost of [
    "attacker.example",
    "127.0.0.1:3012",
    "localhost:3012",
    "127.0.0.1:3012, attacker.example",
    null,
    undefined,
  ]) {
    assert.equal(
      resolveAuthRedirectOrigin(requestHost, { NEXT_PUBLIC_SITE_URL: HOSTED }),
      HOSTED,
    );
    assert.equal(
      resolveAuthRedirectOrigin(requestHost, {
        VERCEL_URL: "preview.vercel.app",
      }),
      "https://preview.vercel.app",
    );
  }
  // A loopback deployment still refuses a non-loopback or mismatched host.
  for (const requestHost of [
    "attacker.example:3012",
    "localhost.evil.example:3012",
    "127.0.0.1:3013",
  ]) {
    assert.equal(
      resolveAuthRedirectOrigin(requestHost, { NEXT_PUBLIC_SITE_URL: LOCAL }),
      LOCAL,
    );
  }
});

test("the confirm link keeps redirectAfterAuth on the selected origin", () => {
  const connectPath = "/organization/dvhs/plugins/dvhs-csf/connect/abc123";
  const origin = resolveAuthRequestOrigin({
    configuredOrigin: LOCAL,
    requestHost: "127.0.0.1:3012",
  });

  assert.equal(
    buildAuthConfirmRedirectUrl(origin, connectPath),
    `${LOOPBACK_IP}/auth/confirm?redirectAfterAuth=${encodeURIComponent(connectPath)}`,
  );
  assert.equal(
    buildAuthConfirmRedirectUrl(
      resolveAuthRequestOrigin({
        configuredOrigin: HOSTED,
        requestHost: "attacker.example",
      }),
      connectPath,
    ),
    `${HOSTED}/auth/confirm?redirectAfterAuth=${encodeURIComponent(connectPath)}`,
  );
  // An unusable redirect is still dropped rather than carried onto the origin.
  assert.equal(
    buildAuthConfirmRedirectUrl(origin, "https://evil.example"),
    `${LOOPBACK_IP}/auth/confirm`,
  );
});

/**
 * `resolveClientAuthOrigin` is the client-initiated counterpart to
 * `resolveAuthRedirectOrigin`: it decides what `redirectTo` origin
 * `AuthenticationClient.tsx`'s Google-linking flow hands Supabase, using
 * `window.location.host` in place of a request `Host` header. There is no
 * DOM in this test file, so `window` is faked and removed around each case.
 */
function withFakeWindow(host: string, run: () => void) {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { host } };
  try {
    run();
  } finally {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = original;
    }
  }
}

test("the client auth origin pins hosted deployments to the canonical origin, never the page's ambient host", () => {
  withFakeWindow("alias.example", () => {
    assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
  });
  withFakeWindow("attacker.example", () => {
    assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
  });
  // The page's own canonical host still resolves to itself.
  withFakeWindow("lets-assist.com", () => {
    assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
  });
});

test("the client auth origin keeps the loopback spelling the browser is actually on", () => {
  withFakeWindow("127.0.0.1:3012", () => {
    assert.equal(resolveClientAuthOrigin(LOCAL), LOOPBACK_IP);
  });
  withFakeWindow("localhost:3012", () => {
    assert.equal(resolveClientAuthOrigin(LOCAL), LOCAL);
  });
  // A different port is a different origin and a different cookie jar, so
  // it is refused just like the server-side resolver refuses it.
  withFakeWindow("127.0.0.1:9999", () => {
    assert.equal(resolveClientAuthOrigin(LOCAL), LOCAL);
  });
});

test("the client auth origin falls back to the loopback default with no configured value and no window", () => {
  assert.equal(resolveClientAuthOrigin(undefined), "http://localhost:3000");
});

test("the client auth origin treats a malformed configured value as absent", () => {
  withFakeWindow("lets-assist.com", () => {
    assert.equal(
      resolveClientAuthOrigin("not a url"),
      "http://localhost:3000",
    );
  });
});

/**
 * The resolver is only worth anything if every auth redirect target goes
 * through it. Several modules used to build their own site origin from
 * `process.env.NEXT_PUBLIC_SITE_URL` with a private fallback, which
 * reintroduced exactly the failure modes this module exists to prevent:
 *
 * - `app/reset-password/actions.ts` had no fallback at all, so an unset
 *   variable interpolated the literal string "undefined" into every
 *   password-reset link;
 * - `app/account/email-actions.ts` and `app/account/security/actions.ts`
 *   fell back to `http://localhost:3000`, so a hosted deployment with a
 *   missing origin mailed users a link only reachable from the server;
 * - `app/api/calendar/google/callback/route.ts` fell back to
 *   `request.nextUrl.origin`, which Next.js derives from the
 *   `x-forwarded-host`/`Host` headers -- a request header choosing the
 *   destination of an authenticated redirect.
 *
 * These are source assertions on purpose: each of those modules is a
 * `"use server"` action or route whose behavior is covered by its own
 * runtime tests, and what needs pinning here is that none of them grows a
 * second, unvalidated origin derivation.
 */
const AUTH_REDIRECT_ORIGIN_CONSUMERS = [
  "app/auth/callback/route.ts",
  "app/auth/confirm/route.ts",
  "app/api/calendar/google/callback/route.ts",
  "app/reset-password/actions.ts",
  "app/account/email-actions.ts",
  "app/account/security/actions.ts",
  "app/anonymous/[id]/actions.ts",
  "app/signup/actions.ts",
];

test("no auth redirect target is built from a raw NEXT_PUBLIC_SITE_URL read", () => {
  for (const path of AUTH_REDIRECT_ORIGIN_CONSUMERS) {
    const source = readFileSync(join(process.cwd(), path), "utf8");

    // The only mentions left are in explanatory comments.
    const codeLines = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line));

    assert.equal(
      codeLines.some((line) => line.includes("process.env.NEXT_PUBLIC_SITE_URL")),
      false,
      `${path} still reads NEXT_PUBLIC_SITE_URL directly`,
    );

    assert.equal(
      source.includes('from "@/app/signup/request-origin"') ||
        source.includes('from "./request-origin"'),
      true,
      `${path} does not import the shared origin resolver`,
    );
  }
});

test("no auth redirect target derives its origin from the request URL or nextUrl", () => {
  for (const path of AUTH_REDIRECT_ORIGIN_CONSUMERS) {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    const codeLines = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line));

    for (const forbidden of [
      "nextUrl.origin",
      "new URL(request.url).origin",
      "requestUrl.origin",
    ]) {
      assert.equal(
        codeLines.some((line) => line.includes(forbidden)),
        false,
        `${path} derives a redirect origin from ${forbidden}`,
      );
    }
  }
});
