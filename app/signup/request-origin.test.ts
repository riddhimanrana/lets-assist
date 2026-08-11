import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthConfirmRedirectUrl } from "./redirect-utils";
import {
  isLoopbackHostname,
  resolveAuthRedirectOrigin,
  resolveAuthRequestOrigin,
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
