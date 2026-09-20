import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PLATFORM_SENDER,
  DEFAULT_ORGANIZATION_SENDER,
  buildOrganizationSenderHeader,
  parsePlatformSender,
  resolvePlatformSender,
  resolvePlatformSenderHeader,
} from "./email-sender-identity";

describe("resolving the configured platform sender", () => {
  test("falls back to the platform default sender when EMAIL_FROM is unset", () => {
    expect(resolvePlatformSenderHeader({})).toBe(DEFAULT_PLATFORM_SENDER);
    expect(resolvePlatformSender({}).mailbox).toBe(
      "projects@notifications.lets-assist.com",
    );
  });

  test("an isolated environment keeps its own transport address", () => {
    const local = {
      EMAIL_FROM: "Let's Assist Local <noreply@lets-assist.local>",
    };
    expect(resolvePlatformSenderHeader(local)).toBe(
      "Let's Assist Local <noreply@lets-assist.local>",
    );
    expect(resolvePlatformSender(local).domain).toBe("lets-assist.local");
  });

  // A whitespace-only EMAIL_FROM used to survive `?? env.trim()`: the empty
  // string is not nullish, so it became the From line and every message left
  // with no sender at all. Blank is unset.
  test("a blank EMAIL_FROM is treated as unset, not as an empty sender", () => {
    expect(resolvePlatformSenderHeader({ EMAIL_FROM: "   " })).toBe(
      DEFAULT_PLATFORM_SENDER,
    );
  });

  test("parses a bare mailbox as well as a display-name header", () => {
    expect(parsePlatformSender("Ops@Notifications.Example.Test")).toMatchObject(
      {
        mailbox: "ops@notifications.example.test",
        displayName: null,
        domain: "notifications.example.test",
      },
    );
    expect(
      parsePlatformSender('"Lets Assist" <ops@example.test>'),
    ).toMatchObject({
      mailbox: "ops@example.test",
      displayName: "Lets Assist",
    });
  });
});

describe("an organization sender over the platform mailbox", () => {
  test("shows the chapter name and keeps the platform address", () => {
    expect(buildOrganizationSenderHeader("DVHS CSF", {})).toBe(
      "DVHS CSF <updates@notifications.lets-assist.com>",
    );
  });

  // Environment isolation: a deployment configured to send elsewhere keeps
  // sending elsewhere, display name and all.
  test("follows the configured mailbox rather than pinning a production address", () => {
    expect(
      buildOrganizationSenderHeader("DVHS CSF", {
        EMAIL_FROM: "Local <noreply@lets-assist.local>",
      }),
    ).toBe("DVHS CSF <noreply@lets-assist.local>");
  });

  // Two independent defences, and this exercises both: the newline is removed
  // rather than escaped, and what is left still carries header punctuation, so
  // the name is refused outright instead of being smuggled into the From line.
  test("a name with a newline cannot inject a header", () => {
    const header = buildOrganizationSenderHeader(
      "DVHS CSF\r\nBcc: someone@example.test",
      {},
    );
    expect(header).not.toInclude("\n");
    expect(header).not.toInclude("Bcc");
    expect(header).toBe(DEFAULT_ORGANIZATION_SENDER);
  });

  // A name that only needed flattening is still usable.
  test("a name with stray inner whitespace is flattened and kept", () => {
    expect(buildOrganizationSenderHeader("  DVHS\t\tCSF  ", {})).toBe(
      "DVHS CSF <updates@notifications.lets-assist.com>",
    );
  });

  test.each([
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
    ["a missing name", null],
    ["a name carrying header punctuation", 'DVHS "CSF" <x@y.test>'],
    ["a name longer than a display name may be", "C".repeat(65)],
  ])("falls back to the platform sender for %s", (_label, name) => {
    expect(buildOrganizationSenderHeader(name, {})).toBe(
      DEFAULT_ORGANIZATION_SENDER,
    );
  });
});
