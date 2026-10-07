import { describe, expect, test } from "bun:test";
import type { CaptureResult } from "posthog-js";
import {
  ANALYTICS_PRIVACY_CONFIG,
  publicAnalyticsUrl,
  sanitizeAnalyticsEvent,
  shouldInitializeAnalytics,
} from "./analytics-privacy";

const uuid = "019a00ab-0000-7000-8000-000000000001";
function event(
  url: string,
  extra: Record<string, unknown> = {},
): CaptureResult {
  return {
    uuid,
    event: "$pageview",
    properties: { distinct_id: uuid, $current_url: url, ...extra },
    $set: { email: "private@example.test" },
    $set_once: {
      $initial_current_url: "https://lets-assist.com/?token=secret-fixture",
    },
  };
}

describe("analytics privacy boundary", () => {
  test("strips all query, fragment, referrer, title, person and arbitrary payload fields", () => {
    const input = event(
      "https://lets-assist.com/home?email=private%40example.test&code=secret-fixture#token=secret-fixture",
      {
        $referrer: "https://school.example.test/?token=secret-fixture",
        $initial_referrer: "https://private.example.test",
        $title: "A private student name",
        nested: { evidence: "private fixture content" },
        $session_id: uuid,
        $viewport_width: 1024,
        $lib_version: "1.413.2",
      },
    );
    const result = sanitizeAnalyticsEvent(input);
    expect(result?.properties.$current_url).toBe(
      "https://lets-assist.com/home",
    );
    expect(result?.properties.$session_id).toBe(uuid);
    expect(result?.properties.$viewport_width).toBe(1024);
    const payload = JSON.stringify(result);
    for (const value of [
      "private",
      "secret-fixture",
      "student",
      "evidence",
      "$set",
      "referrer",
    ]) {
      expect(payload).not.toContain(value);
    }
    expect(input.properties.$title).toBe("A private student name");
  });

  test.each([
    "/login?email=private@example.test",
    "/signup",
    "/auth/callback?code=secret-fixture",
    "/account",
    "/dashboard",
    "/admin",
    "/organization/example/plugins/dvhs-csf",
    "/organization/example",
    "/projects/create",
    `/projects/${uuid}/edit`,
    "/invite/secret-fixture",
    "/certificates/secret-fixture",
    "/future-private-route",
  ])("drops private or unreviewed route %s", (path) => {
    expect(
      sanitizeAnalyticsEvent(event(`https://lets-assist.com${path}`)),
    ).toBeNull();
  });

  test.each([
    "$snapshot",
    "$identify",
    "$exception",
    "$autocapture",
    "$web_vitals",
    "$pageleave",
    "new_unreviewed_event",
  ])("drops unreviewed event type %s", (name) => {
    expect(
      sanitizeAnalyticsEvent({
        ...event("https://lets-assist.com/"),
        event: name,
      }),
    ).toBeNull();
  });

  test("normalizes dynamic public identifiers and www without retaining the original path", () => {
    expect(
      publicAnalyticsUrl(
        `https://lets-assist.com/projects/${uuid}?secret=fixture`,
      )?.pathname,
    ).toBe("/projects/[id]");
    expect(
      publicAnalyticsUrl("https://www.lets-assist.com/profile/synthetic-person")
        ?.href,
    ).toBe("https://lets-assist.com/profile/[username]");
  });

  test.each([
    "https://dev.lets-assist.com/home",
    "https://preview.vercel.app/home",
    "http://lets-assist.com/",
    "https://localhost/",
    "https://user:secret@lets-assist.com/",
    "not a URL",
  ])("rejects untrusted origin %s", (url) =>
    expect(publicAnalyticsUrl(url)).toBeNull(),
  );

  test("rejects identified personal IDs and drops invalid numeric and session fields", () => {
    expect(
      sanitizeAnalyticsEvent(
        event("https://lets-assist.com/", {
          distinct_id: "private@example.test",
        }),
      ),
    ).toBeNull();
    const result = sanitizeAnalyticsEvent(
      event("https://lets-assist.com/", {
        $session_id: "secret-fixture",
        $viewport_width: Infinity,
        $screen_height: -1,
      }),
    );
    expect(result?.properties).not.toHaveProperty("$session_id");
    expect(result?.properties).not.toHaveProperty("$viewport_width");
    expect(result?.properties).not.toHaveProperty("$screen_height");
  });

  test("initializes only on the public Production origin and production builds", () => {
    const location = { hostname: "lets-assist.com", protocol: "https:" };
    expect(
      shouldInitializeAnalytics(location, "production", "production"),
    ).toBe(true);
    expect(shouldInitializeAnalytics(location, "production", undefined)).toBe(
      true,
    );
    expect(shouldInitializeAnalytics(location, "production", "preview")).toBe(
      false,
    );
    expect(shouldInitializeAnalytics(location, "development", undefined)).toBe(
      false,
    );
    expect(
      shouldInitializeAnalytics(
        { ...location, hostname: "dev.lets-assist.com" },
        "production",
        undefined,
      ),
    ).toBe(false);
  });

  test("uses the sanitizing callback and prevents remote config from restoring broad capture", () => {
    expect(
      ANALYTICS_PRIVACY_CONFIG.before_send(
        event("https://lets-assist.com/account"),
      ),
    ).toBeNull();
    expect(ANALYTICS_PRIVACY_CONFIG).toMatchObject({
      autocapture: false,
      disable_session_recording: true,
      enable_recording_console_log: false,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      person_profiles: "never",
      ip: false,
      respect_dnt: true,
    });
  });
});
