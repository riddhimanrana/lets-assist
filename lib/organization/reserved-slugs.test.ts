import { describe, expect, test } from "bun:test";

import {
  RESERVED_ORGANIZATION_SLUGS,
  isReservedOrganizationSlug,
  normalizeOrganizationSlugForReservedCheck,
} from "./reserved-slugs";

/**
 * `create` and `join` are static routes under `app/organization`
 * (`app/organization/create`, `app/organization/join`). An organization
 * claiming either username as its `/organization/<username>` path segment
 * would be unreachable at its own profile URL and would shadow -- or be
 * shadowed by -- the platform route. This matrix mirrors the adversarial
 * shape of `app/signup/request-origin.test.ts`: every case, whitespace, and
 * Unicode-compatibility spelling of a reserved slug must still resolve to
 * "reserved", while ordinary usernames -- including ones that merely
 * contain a reserved word -- must not be caught by the check.
 */
describe("RESERVED_ORGANIZATION_SLUGS", () => {
  test("covers exactly the static/special child routes of app/organization", () => {
    // `[id]` is the only dynamic segment; every other child directory is a
    // platform route that a username would collide with.
    expect([...RESERVED_ORGANIZATION_SLUGS].sort()).toEqual([
      "create",
      "join",
    ]);
  });
});

describe("isReservedOrganizationSlug", () => {
  test("rejects the exact reserved spellings", () => {
    expect(isReservedOrganizationSlug("create")).toBe(true);
    expect(isReservedOrganizationSlug("join")).toBe(true);
  });

  test("rejects case variations", () => {
    for (const value of [
      "Create",
      "CREATE",
      "cReAtE",
      "Join",
      "JOIN",
      "jOiN",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(true);
    }
  });

  test("rejects surrounding whitespace", () => {
    for (const value of [
      " create",
      "create ",
      "  create  ",
      "\tcreate\n",
      " Join ",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(true);
    }
  });

  test("rejects Unicode compatibility variants that normalize to a reserved word", () => {
    // Full-width Latin letters (U+FF43 etc.) NFKC-normalize to ASCII.
    expect(isReservedOrganizationSlug("ｃｒｅａｔｅ")).toBe(
      true,
    );
    expect(isReservedOrganizationSlug("ｊｏｉｎ")).toBe(true);
    // A single ligature codepoint (U+FB01 "fi") NFKC-decomposes to "fi".
    expect(isReservedOrganizationSlug("ﬁ")).toBe(false); // sanity: "fi" alone isn't reserved
  });

  test("rejects combined case, whitespace, and Unicode-compatibility tricks", () => {
    expect(isReservedOrganizationSlug(" Ｃreate ")).toBe(true); // fullwidth "C" + "reate", padded
  });

  test("accepts ordinary usernames unaffected by the reserved set", () => {
    for (const value of [
      "lets-assist",
      "acme-nonprofit",
      "dvhs",
      "my_org.2026",
      "a",
      "",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(false);
    }
  });

  test("does not treat a reserved word as a substring match", () => {
    // These merely contain "create"/"join" and must remain available.
    for (const value of [
      "creators",
      "createorg",
      "the-creators-collective",
      "rejoin",
      "joint-venture",
      "enjoin",
    ]) {
      expect(isReservedOrganizationSlug(value)).toBe(false);
    }
  });

  test("null-ish and non-string-shaped edge cases never throw", () => {
    expect(() => isReservedOrganizationSlug("")).not.toThrow();
    expect(isReservedOrganizationSlug("")).toBe(false);
  });
});

describe("normalizeOrganizationSlugForReservedCheck", () => {
  test("trims, lowercases, and NFKC-normalizes", () => {
    expect(normalizeOrganizationSlugForReservedCheck("  Create  ")).toBe(
      "create",
    );
    expect(
      normalizeOrganizationSlugForReservedCheck(
        "ＣＲＥＡＴＥ",
      ),
    ).toBe("create");
  });

  test("is idempotent", () => {
    const once = normalizeOrganizationSlugForReservedCheck(" Join ");
    expect(normalizeOrganizationSlugForReservedCheck(once)).toBe(once);
  });
});
