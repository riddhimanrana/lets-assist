import { describe, expect, test } from "bun:test";

import { checkWaiverAccess, type AuthCheckParams } from "./preview-auth-helpers";

function params(overrides: Partial<AuthCheckParams> = {}): AuthCheckParams {
  return {
    currentUserId: "staff-user",
    signature: { user_id: "signer-user", anonymous_id: null },
    project: {
      creator_id: "creator-user",
      organization_id: "organization-id",
      can_be_managed_by_staff: false,
    },
    orgMember: { role: "staff" },
    ...overrides,
  };
}

describe("checkWaiverAccess organization boundary", () => {
  test("does not let staff read waivers when staff management is disabled", () => {
    expect(checkWaiverAccess(params())).toMatchObject({
      hasPermission: false,
      reason: "unauthorized",
    });
  });

  test("lets staff read waivers when staff management is enabled", () => {
    expect(
      checkWaiverAccess(
        params({
          project: {
            creator_id: "creator-user",
            organization_id: "organization-id",
            can_be_managed_by_staff: true,
          },
        }),
      ),
    ).toMatchObject({ hasPermission: true, reason: "organizer" });
  });

  test("keeps organization admin access independent of the staff flag", () => {
    expect(checkWaiverAccess(params({ orgMember: { role: "admin" } }))).toMatchObject({
      hasPermission: true,
      reason: "organizer",
    });
  });
});
