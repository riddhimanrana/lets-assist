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
    "/.//evil.example/path",
    "/..//evil.example",
    "/a/..//evil.example",
    "https://lets-assist.com//evil.example/path",
    "https://lets-assist.com/.//evil.example",
    "https://user:pass@example.org/a",
    "https://lets-assist.com.evil.example/a".replace("https:", "http:"),
  ])("refuses %p", (value) => {
    expect(resolveNotificationAction(value, origin)).toBeNull();
  });

  test("dot segments are resolved before the path is returned", () => {
    expect(resolveNotificationAction("/a/./b/../c?x=1", origin)).toEqual({
      kind: "internal",
      href: "/a/c?x=1",
    });
  });

  test("a lookalike host is external, never internal", () => {
    expect(
      resolveNotificationAction(
        "https://lets-assist.com.evil.example/a",
        origin,
      ),
    ).toEqual({
      kind: "external",
      href: "https://lets-assist.com.evil.example/a",
    });
  });

  test("missing values are refused", () => {
    expect(resolveNotificationAction(null, origin)).toBeNull();
    expect(resolveNotificationAction(undefined, origin)).toBeNull();
  });
});
