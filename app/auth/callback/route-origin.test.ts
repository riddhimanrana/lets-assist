import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";

/**
 * `/auth/callback` finishes PKCE code exchange, OAuth login, signup
 * confirmation, password recovery, and staff-invite linking, so every
 * redirect it emits has to stay on the origin that holds the session and
 * PKCE verifier cookies. The handler used to build that origin from the
 * raw `x-forwarded-host` request header, which a client fully controls: a
 * request through any proxy that forwards the header unchecked, or a
 * direct request that simply sets it, could redirect a completed sign-in
 * to `https://<attacker-supplied-host>${destinationPath}`.
 *
 * The fix routes every redirect through `resolveAuthRedirectOrigin`, the
 * same trusted-origin resolver `/auth/confirm` already uses: hosted
 * deployments are pinned to the configured origin (`NEXT_PUBLIC_SITE_URL`
 * or `VERCEL_URL`) regardless of any request header, and only a loopback
 * deployment answering the same loopback service and port may keep the
 * browser's own loopback spelling.
 */
describe("auth callback redirect origin", () => {
  const source = readFileSync(join(import.meta.dir, "route.ts"), "utf8");

  test("resolves one validated redirect origin from the request Host", () => {
    expect(source).toContain(
      'import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";',
    );
    expect(source).toContain(
      'const authOrigin = resolveAuthRedirectOrigin(request.headers.get("host"));',
    );
  });

  test("never trusts x-forwarded-host or a raw NODE_ENV origin branch", () => {
    expect(source).not.toMatch(/x-forwarded-host/u);
    expect(source).not.toMatch(/forwardedHost/u);
  });

  test("never derives a redirect origin from request.url", () => {
    // `new URL(request.url)` is still how the handler reads its own query
    // string; what must not come back is an origin or a redirect base.
    expect(source).not.toMatch(/new URL\(\s*request\.url\s*\)\s*\.origin/u);
    expect(source).not.toMatch(/,\s*origin\s*\)/u);
    expect(source).not.toMatch(/searchParams,\s*origin\s*\}/u);
  });

  test("routes every redirect through the resolved origin", () => {
    // Every redirect target in the file is built from `authOrigin`; no bare
    // `origin` identifier (the request.url-derived value this replaced)
    // should remain anywhere in a redirect construction.
    const redirectTargets = [
      ...source.matchAll(/`\$\{(\w+)\}[^`]*`/gu),
    ].map((match) => match[1]);
    expect(redirectTargets.length).toBeGreaterThan(0);
    for (const identifier of redirectTargets) {
      expect(identifier).toBe("authOrigin");
    }

    const urlConstructions = [
      ...source.matchAll(/new URL\(\s*`\$\{(\w+)\}[^`]*`\s*\)/gu),
    ].map((match) => match[1]);
    expect(urlConstructions.length).toBeGreaterThan(0);
    for (const identifier of urlConstructions) {
      expect(identifier).toBe("authOrigin");
    }
  });
});

/**
 * The adversarial matrix below mirrors `app/signup/request-origin.test.ts`,
 * applied to the concrete redirect shapes `/auth/callback` builds:
 * `/reset-password/<code>` (recovery), `/login`, `/error`,
 * `/account/authentication`, `/auth/verification-success` (signup
 * confirmation), an MFA continuation path, and the post-auth destination
 * path (which can carry a staff-invite or CSF-connect continuation). For
 * every adversarial `Host` value the resulting redirect must land on the
 * trusted origin -- never on an attacker-controlled host, scheme, or port.
 */
describe("auth callback adversarial Host matrix", () => {
  const HOSTED = "https://lets-assist.com";
  const PREVIEW_ENV = { VERCEL_URL: "my-branch-abc123.vercel.app" };
  const LOOPBACK_ENV = { NEXT_PUBLIC_SITE_URL: "http://localhost:3012" };

  const redirectPaths = [
    "/reset-password/some-code",
    "/login?error=email-password-exists",
    "/error",
    "/account/authentication?error=linking_failed",
    "/auth/verification-success?type=signup",
    "/auth/mfa?redirect=%2Fhome",
    "/home",
  ];

  const adversarialHosts = [
    "evil.example",
    "evil.example:3012",
    "lets-assist.com.evil.example",
    "lets-assist.com@evil.example",
    "lets-assist.com%2f@evil.example",
    "lets-assist.com, evil.example",
    "127.0.0.1:3012, evil.example",
    "user@lets-assist.com",
    "lets-assist.com/../../evil.example",
    "lets-assist.com\nX-Injected: 1",
    "lets-assist.com\r\nSet-Cookie: pwned=1",
    "",
    "   ",
    null,
    undefined,
    "0.0.0.0:3012",
    "[::1]:9999",
    "ftp://evil.example",
    "https://evil.example",
    "lets-assist.com:445566",
  ];

  test("hosted deployment redirects stay on the configured origin for every adversarial Host", () => {
    for (const host of adversarialHosts) {
      const authOrigin = resolveAuthRedirectOrigin(host, {
        NEXT_PUBLIC_SITE_URL: HOSTED,
      });
      expect(authOrigin).toBe(HOSTED);

      for (const path of redirectPaths) {
        const redirectUrl = new URL(`${authOrigin}${path}`);
        expect(redirectUrl.origin).toBe(HOSTED);
      }
    }
  });

  test("preview deployment redirects stay on the Vercel-issued origin for every adversarial Host", () => {
    for (const host of adversarialHosts) {
      const authOrigin = resolveAuthRedirectOrigin(host, PREVIEW_ENV);
      expect(authOrigin).toBe("https://my-branch-abc123.vercel.app");

      for (const path of redirectPaths) {
        const redirectUrl = new URL(`${authOrigin}${path}`);
        expect(redirectUrl.origin).toBe("https://my-branch-abc123.vercel.app");
      }
    }
  });

  test("loopback dev deployment redirects never move off the configured loopback service", () => {
    // A same-service, same-port loopback spelling swap is the one allowed
    // deviation (the PKCE-verifier-cookie regression this resolver fixes);
    // everything else, including a same-machine Host on the wrong port,
    // must fall back to the configured origin.
    for (const host of [
      ...adversarialHosts,
      "127.0.0.1:9999",
      "localhost:9999",
    ]) {
      const authOrigin = resolveAuthRedirectOrigin(host, LOOPBACK_ENV);
      const isAllowedLoopbackSwap =
        authOrigin === "http://127.0.0.1:3012" ||
        authOrigin === "http://localhost:3012";
      expect(isAllowedLoopbackSwap).toBe(true);

      for (const path of redirectPaths) {
        const redirectUrl = new URL(`${authOrigin}${path}`);
        expect(["localhost", "127.0.0.1"]).toContain(redirectUrl.hostname);
        expect(redirectUrl.port).toBe("3012");
        expect(redirectUrl.protocol).toBe("http:");
      }
    }
  });

  test("the legitimate loopback spelling swap still resolves for the callback route", () => {
    // This is the regression the resolver exists to fix: a developer
    // confirming on 127.0.0.1 while NEXT_PUBLIC_SITE_URL says localhost must
    // still get redirected back to 127.0.0.1, the origin holding the
    // session cookies -- not lose that continuity to a stale `origin`.
    const authOrigin = resolveAuthRedirectOrigin("127.0.0.1:3012", LOOPBACK_ENV);
    expect(authOrigin).toBe("http://127.0.0.1:3012");
    expect(new URL(`${authOrigin}/home`).toString()).toBe(
      "http://127.0.0.1:3012/home",
    );
  });
});
