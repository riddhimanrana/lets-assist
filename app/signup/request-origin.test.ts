import assert from "node:assert/strict";
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

test("a non-Vercel NODE_ENV=production deployment fails closed instead of returning localhost", () => {
  // `localhost` is never a valid auth redirect target for a production
  // deployment, regardless of whether Vercel's own environment signals exist.
  assert.throws(() => resolveConfiguredSiteOrigin({ NODE_ENV: "production" }));
  assert.throws(() =>
    resolveConfiguredSiteOrigin({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "not a url",
    }),
  );
  // A valid configured origin is always trusted, even in non-Vercel production.
  assert.equal(
    resolveConfiguredSiteOrigin({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: HOSTED,
    }),
    HOSTED,
  );
  // A non-production process with no Vercel signals still gets the loopback default.
  assert.equal(
    resolveConfiguredSiteOrigin({ NODE_ENV: "development" }),
    "http://localhost:3000",
  );
  assert.equal(resolveConfiguredSiteOrigin({}), "http://localhost:3000");
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
function withFakeWindow(
  location: { host: string; origin?: string },
  run: () => void,
) {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location };
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
  withFakeWindow(
    { host: "alias.example", origin: "https://alias.example" },
    () => {
      assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
    },
  );
  withFakeWindow(
    { host: "attacker.example", origin: "https://attacker.example" },
    () => {
      assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
    },
  );
  // The page's own canonical host still resolves to itself.
  withFakeWindow({ host: "lets-assist.com", origin: HOSTED }, () => {
    assert.equal(resolveClientAuthOrigin(HOSTED), HOSTED);
  });
});

test("the client auth origin keeps the loopback spelling the browser is actually on", () => {
  withFakeWindow(
    { host: "127.0.0.1:3012", origin: "http://127.0.0.1:3012" },
    () => {
      assert.equal(resolveClientAuthOrigin(LOCAL), LOOPBACK_IP);
    },
  );
  withFakeWindow(
    { host: "localhost:3012", origin: "http://localhost:3012" },
    () => {
      assert.equal(resolveClientAuthOrigin(LOCAL), LOCAL);
    },
  );
  // A different port is a different origin and a different cookie jar, so
  // it is refused just like the server-side resolver refuses it.
  withFakeWindow(
    { host: "127.0.0.1:9999", origin: "http://127.0.0.1:9999" },
    () => {
      assert.equal(resolveClientAuthOrigin(LOCAL), LOCAL);
    },
  );
});

test("the client auth origin falls back to the loopback default with no configured value and no window", () => {
  assert.equal(resolveClientAuthOrigin(undefined), "http://localhost:3000");
});

test("the client auth origin uses window.location.origin when no NEXT_PUBLIC_SITE_URL is configured", () => {
  // A hosted preview with no NEXT_PUBLIC_SITE_URL inlined at build time must
  // not fall back to localhost:3000 -- that is an unreachable redirectTo.
  // The page's actual origin (from window.location.origin) is used instead.
  withFakeWindow(
    {
      host: "my-branch-abc123.vercel.app",
      origin: "https://my-branch-abc123.vercel.app",
    },
    () => {
      assert.equal(
        resolveClientAuthOrigin(undefined),
        "https://my-branch-abc123.vercel.app",
      );
      assert.equal(
        resolveClientAuthOrigin("not a url"),
        "https://my-branch-abc123.vercel.app",
      );
    },
  );
});

test("the client auth origin treats a malformed configured value as absent and falls back to window.location.origin", () => {
  // When NEXT_PUBLIC_SITE_URL is malformed AND the browser is on a hosted
  // origin, window.location.origin is the correct fallback -- not localhost.
  withFakeWindow(
    { host: "lets-assist.com", origin: "https://lets-assist.com" },
    () => {
      assert.equal(
        resolveClientAuthOrigin("not a url"),
        "https://lets-assist.com",
      );
    },
  );
  // When window.location.origin itself is absent (e.g. very old test stubs),
  // localhost:3000 is still the last resort.
  withFakeWindow({ host: "lets-assist.com" }, () => {
    assert.equal(resolveClientAuthOrigin("not a url"), "http://localhost:3000");
  });
});
