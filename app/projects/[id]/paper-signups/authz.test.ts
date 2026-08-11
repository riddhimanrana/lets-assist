import { describe, expect, test } from "bun:test";

import { canManageProjectAccess } from "@/lib/projects/management-access";

/**
 * The paper-signup decision table. Every server action in this directory
 * gates on canManageProjectAccess, and the commit RPC re-checks the same
 * policy in SQL via app_private.can_manage_project — the pgTAP suite
 * (paper_signup_scan_commit.test.sql) asserts the SQL side; this file pins
 * the TypeScript side so the two cannot silently drift apart.
 */

const CREATOR = "creator-1";
const OTHER = "user-2";

describe("paper signup management access", () => {
  test("the project creator can manage", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: CREATOR,
        organizationRole: null,
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("an org admin can manage regardless of the staff flag", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "admin",
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("org staff can manage only when the project opted in", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: true,
      }),
    ).toBe(true);
  });

  test("org staff cannot manage when the project opted out", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: false,
      }),
    ).toBe(false);
  });

  test("staff with an absent flag are denied, not defaulted in", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "staff",
        canBeManagedByStaff: null,
      }),
    ).toBe(false);
  });

  test("plain members and unrelated users are denied", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: "member",
        canBeManagedByStaff: true,
      }),
    ).toBe(false);
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: OTHER,
        organizationRole: null,
        canBeManagedByStaff: true,
      }),
    ).toBe(false);
  });
});
