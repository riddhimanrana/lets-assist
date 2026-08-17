import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_CONNECT_PATH,
  LEGACY_GOOGLE_OAUTH_CALLBACK_PATH,
  LEGACY_GOOGLE_OAUTH_CONNECT_PATH,
  resolveGoogleOAuthCallbackPath,
} from "./google-oauth-callback-path";

/**
 * The Google OAuth routes are provider-scoped, not calendar-scoped: one
 * connect/callback/disconnect trio serves personal calendar, organization
 * calendar, Sheets, Drive and the DVHS-CSF import surfaces. Mounting them
 * under `/api/calendar` made a Sheets import failure look like a calendar
 * problem. These tests pin the canonical shape and the compatibility mounts
 * that must survive until every environment's registered redirect URI moves.
 */

function routeSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("Google OAuth route shape", () => {
  test("the canonical routes are provider-scoped", () => {
    expect(GOOGLE_OAUTH_CONNECT_PATH).toBe("/api/google/oauth/connect");
    expect(GOOGLE_OAUTH_CALLBACK_PATH).toBe("/api/google/oauth/callback");
    for (const path of [
      GOOGLE_OAUTH_CONNECT_PATH,
      GOOGLE_OAUTH_CALLBACK_PATH,
    ]) {
      expect(path.startsWith("/api/google/")).toBe(true);
    }
  });

  test("all three verbs exist under the canonical prefix", () => {
    for (const verb of ["connect", "callback", "disconnect"]) {
      expect(
        existsSync(
          new URL(`../../app/api/google/oauth/${verb}/route.ts`, import.meta.url),
        ),
      ).toBe(true);
    }
  });

  test("the legacy mounts re-export the canonical handler rather than forking", () => {
    const connect = routeSource("app/api/calendar/google/connect/route.ts");
    expect(connect).toContain("@/app/api/google/oauth/connect/route");
    const disconnect = routeSource(
      "app/api/calendar/google/disconnect/route.ts",
    );
    expect(disconnect).toContain("@/app/api/google/oauth/disconnect/route");
    // A shim that grew its own logic would drift from the canonical route.
    expect(disconnect.split("\n").length).toBeLessThan(20);
  });

  test("the callback path follows the environment's registered redirect URI", () => {
    // Changing this path requires updating the redirect URI registered in the
    // Google Cloud console, so an environment still on the legacy path must
    // keep working rather than silently losing its attempt cookie.
    expect(
      resolveGoogleOAuthCallbackPath(
        `http://localhost:3000${LEGACY_GOOGLE_OAUTH_CALLBACK_PATH}`,
      ),
    ).toBe(LEGACY_GOOGLE_OAUTH_CALLBACK_PATH);
    expect(
      resolveGoogleOAuthCallbackPath(
        `https://lets-assist.com${GOOGLE_OAUTH_CALLBACK_PATH}`,
      ),
    ).toBe(GOOGLE_OAUTH_CALLBACK_PATH);
  });

  test("an unrecognized or unparseable redirect URI fails closed", () => {
    expect(resolveGoogleOAuthCallbackPath("https://evil.test/api/steal")).toBe(
      GOOGLE_OAUTH_CALLBACK_PATH,
    );
    expect(resolveGoogleOAuthCallbackPath("not-a-url")).toBe(
      GOOGLE_OAUTH_CALLBACK_PATH,
    );
    expect(resolveGoogleOAuthCallbackPath(undefined)).toBe(
      GOOGLE_OAUTH_CALLBACK_PATH,
    );
  });

  test("a missing provider configuration redirects instead of dead-ending", () => {
    const connect = routeSource("app/api/google/oauth/connect/route.ts");
    // A JSON 500 strands the officer mid-navigation with no way back.
    expect(connect).not.toContain("Calendar integration is not configured");
    expect(connect).toContain("google_not_configured");
    expect(connect).toContain("NextResponse.redirect");
  });

  test("no product surface links to a legacy mount", () => {
    expect(LEGACY_GOOGLE_OAUTH_CONNECT_PATH).toBe(
      "/api/calendar/google/connect",
    );
    // Sanity: the constants still describe the mounts the shims provide.
    expect(LEGACY_GOOGLE_OAUTH_CALLBACK_PATH).toBe(
      "/api/calendar/google/callback",
    );
  });
});
