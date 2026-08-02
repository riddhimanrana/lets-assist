import { describe, expect, test } from "bun:test";

import {
  hasOrganizationPluginRoleAccess,
  toOrganizationPluginAccessRole,
} from "./access-role";

describe("organization plugin access roles", () => {
  test.each([
    ["admin", "admin"],
    ["staff", "staff"],
    ["member", "member"],
    ["owner", null],
    ["", null],
    [null, null],
    [undefined, null],
  ] as const)("normalizes %p", (value, expected) => {
    expect(toOrganizationPluginAccessRole(value)).toBe(expected);
  });

  test("enforces the role hierarchy", () => {
    expect(hasOrganizationPluginRoleAccess("member", "member")).toBe(true);
    expect(hasOrganizationPluginRoleAccess("member", "staff")).toBe(false);
    expect(hasOrganizationPluginRoleAccess("staff", "member")).toBe(true);
    expect(hasOrganizationPluginRoleAccess("staff", "admin")).toBe(false);
    expect(hasOrganizationPluginRoleAccess("admin", "admin")).toBe(true);
  });

  test("allows public and unspecified access", () => {
    expect(hasOrganizationPluginRoleAccess("member", "public")).toBe(true);
    expect(hasOrganizationPluginRoleAccess("member", undefined)).toBe(true);
  });
});
