import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `/auth/confirm` is the hop that finishes an emailed confirmation, so every
 * redirect it emits has to stay on the origin that just proved the PKCE
 * exchange. `NextRequest.url` cannot express that: Next.js rebuilds it from the
 * server's own binding, so on the isolated CSF stack -- served on
 * `http://127.0.0.1:<port>` while `NEXT_PUBLIC_SITE_URL` is
 * `http://localhost:<port>` -- a handler reading `request.url` sees the
 * `localhost` spelling regardless of the `Host` the browser sent. Redirecting
 * there moved the verified account, its `redirectAfterAuth` continuation, and
 * its cookies onto a different origin than the one holding the session.
 *
 * These assertions are on the route source rather than a live server because
 * the defect is exactly the choice of origin source, and that choice is not
 * observable from a unit-level invocation of the handler.
 */
describe("auth confirmation redirect origin", () => {
  const source = readFileSync(join(import.meta.dir, "route.ts"), "utf8");

  test("resolves one validated redirect origin from the request Host", () => {
    expect(source).toContain(
      'import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";',
    );
    expect(source).toContain(
      'const authOrigin = resolveAuthRedirectOrigin(request.headers.get("host"));',
    );
  });

  test("never derives a redirect origin from request.url", () => {
    // `new URL(request.url)` is still how the handler reads its own query
    // string; what must not come back is an origin or a redirect base.
    expect(source).not.toMatch(/new URL\(\s*request\.url\s*\)\s*\.origin/u);
    expect(source).not.toMatch(/,\s*request\.url\s*\)/u);
    expect(source).not.toMatch(/\$\{\s*new URL\(\s*request\.url\s*\)/u);
  });

  test("routes every confirmation hop through the resolved origin", () => {
    expect(source).toContain(
      "const redirectUrl = new URL(`${origin}/auth/verification-success`);",
    );
    expect(source).toContain(
      'const url = new URL("/auth/email-expired", authOrigin);',
    );
    // Each redirectToSuccess call site passes the resolved origin, and none
    // passes the request back in.
    const successCalls = [...source.matchAll(/redirectToSuccess\(\s*(\w+)/gu)]
      .map((match) => match[1])
      .filter((argument) => argument !== "origin");
    expect(successCalls.length).toBe(3);
    for (const argument of successCalls) {
      expect(argument).toBe("authOrigin");
    }
  });

  test("keeps the emailed continuation path normalized and unchanged", () => {
    // The connect route the signup carried has to survive the confirmation,
    // and it is still validated as a same-origin path before it is echoed.
    expect(source).toContain(
      'import { normalizeRedirectPath } from "@/app/signup/redirect-utils";',
    );
    expect(source).toMatch(
      /normalizeRedirectPath\(\s*searchParams\.get\("redirectAfterAuth"\),?\s*\)/u,
    );
    expect(source).toContain(
      'redirectUrl.searchParams.set("redirectAfterAuth", redirectAfterAuth);',
    );
  });
});
