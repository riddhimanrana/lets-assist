import { describe, expect, test } from "bun:test";

import {
  ORGANIZATION_USERNAME_MAX_LENGTH,
  ORGANIZATION_USERNAME_MIN_LENGTH,
  organizationUsernameSchema,
  validateOrganizationUsername,
} from "./username";

describe("organizationUsernameSchema", () => {
  test("accepts the documented ASCII format and boundary lengths", () => {
    for (const username of [
      "abc",
      "A_b.c-9",
      "a".repeat(ORGANIZATION_USERNAME_MAX_LENGTH),
    ]) {
      expect(organizationUsernameSchema.safeParse(username).success).toBe(true);
      expect(validateOrganizationUsername(username)).toEqual({ ok: true });
    }
  });

  test("rejects values outside 3 through 32 characters", () => {
    for (const username of [
      "a".repeat(ORGANIZATION_USERNAME_MIN_LENGTH - 1),
      "a".repeat(ORGANIZATION_USERNAME_MAX_LENGTH + 1),
    ]) {
      expect(validateOrganizationUsername(username).ok).toBe(false);
    }
  });

  test("rejects non-ASCII, whitespace, controls, URL separators, and astral characters", () => {
    for (const username of [
      "café",
      "fullｗidth",
      "with space",
      "line\nbreak",
      "slash/name",
      "query?name",
      "abc😀",
      `ab${String.fromCodePoint(0x1d400)}`,
    ]) {
      expect(validateOrganizationUsername(username).ok).toBe(false);
    }
  });

  test("rejects leading, trailing, and consecutive dots", () => {
    for (const username of [".abc", "abc.", "ab..cd", "..."]) {
      expect(validateOrganizationUsername(username).ok).toBe(false);
    }
  });
});
