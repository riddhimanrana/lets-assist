import { describe, expect, test } from "bun:test";

import { resolveNotificationAction } from "./notification-action-url";

const origin = "https://lets-assist.com";

describe("resolveNotificationAction", () => {
  test("a site path navigates in place", () => {
    expect(resolveNotificationAction("/projects/abc?tab=1#x", origin)).toEqual({
      kind: "internal",
      href: "/projects/abc?tab=1#x",
    });
  });

  test("an absolute link to this site is reduced to its path", () => {
    expect(
      resolveNotificationAction(`${origin}/organization/x?tab=members`, origin),
    ).toEqual({ kind: "internal", href: "/organization/x?tab=members" });
  });

  test("an https link to another site is external", () => {
    expect(resolveNotificationAction("https://example.org/a", origin)).toEqual({
      kind: "external",
      href: "https://example.org/a",
    });
  });

  test.each([
    "//evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://example.org/insecure",
    "not a url",
    "",
    "   ",
    "/ok\u0000path",
  ])("refuses %p", (value) => {
    expect(resolveNotificationAction(value, origin)).toBeNull();
  });

  test("missing values are refused", () => {
    expect(resolveNotificationAction(null, origin)).toBeNull();
    expect(resolveNotificationAction(undefined, origin)).toBeNull();
  });
});
