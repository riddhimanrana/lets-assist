import { describe, expect, test } from "bun:test";

import {
  WAIVER_SIGNED_URL_TTL_SECONDS,
  checkWaiverAccess,
  getContentDisposition,
  resolveWaiverContentType,
  type AuthCheckParams,
} from "./preview-auth-helpers";

function params(overrides: Partial<AuthCheckParams> = {}): AuthCheckParams {
  return {
    currentUserId: "staff-user",
    signature: { user_id: "signer-user", anonymous_id: null },
    project: {
      creator_id: "creator-user",
      organization_id: "organization-id",
      can_be_managed_by_staff: false,
    },
    orgMember: { role: "staff", status: "active" },
    ...overrides,
  };
}

const staffManagedProject = {
  creator_id: "creator-user",
  organization_id: "organization-id",
  can_be_managed_by_staff: true,
};

describe("checkWaiverAccess organization boundary", () => {
  test("does not let staff read waivers when staff management is disabled", () => {
    expect(checkWaiverAccess(params())).toMatchObject({
      hasPermission: false,
      reason: "unauthorized",
    });
  });

  test("lets active staff read waivers when staff management is enabled", () => {
    expect(
      checkWaiverAccess(params({ project: staffManagedProject })),
    ).toMatchObject({ hasPermission: true, reason: "organizer" });
  });

  test("keeps active admin access independent of the staff flag", () => {
    expect(
      checkWaiverAccess(
        params({ orgMember: { role: "admin", status: "active" } }),
      ),
    ).toMatchObject({
      hasPermission: true,
      reason: "organizer",
    });
  });

  test.each([
    ["inactive admin", { role: "admin", status: "inactive" }],
    ["invited admin", { role: "admin", status: "invited" }],
    ["inactive staff", { role: "staff", status: "inactive" }],
    ["invited staff", { role: "staff", status: "invited" }],
    ["admin with no status", { role: "admin", status: null }],
    ["admin row missing its status", { role: "admin" }],
    ["admin with an unknown status", { role: "admin", status: "suspended" }],
  ])("refuses an %s", (_label, orgMember) => {
    expect(
      checkWaiverAccess(params({ orgMember, project: staffManagedProject })),
    ).toMatchObject({ hasPermission: false, reason: "unauthorized" });
  });

  test("refuses an active plain member", () => {
    expect(
      checkWaiverAccess(
        params({
          orgMember: { role: "member", status: "active" },
          project: staffManagedProject,
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });

  test("ignores a membership when the project has no organization", () => {
    expect(
      checkWaiverAccess(
        params({
          orgMember: { role: "admin", status: "active" },
          project: {
            creator_id: "creator-user",
            organization_id: null,
            can_be_managed_by_staff: true,
          },
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });

  test("refuses an unrelated signed-in user", () => {
    expect(
      checkWaiverAccess(
        params({ currentUserId: "someone-else", orgMember: null }),
      ),
    ).toMatchObject({ hasPermission: false, reason: "unauthorized" });
  });

  test("refuses a request with no session and no guest link", () => {
    expect(
      checkWaiverAccess(params({ currentUserId: null, orgMember: null })),
    ).toMatchObject({ hasPermission: false });
  });

  test("does not treat a project without a creator as owned by anyone", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: "someone-else",
          orgMember: null,
          project: {
            creator_id: null,
            organization_id: null,
            can_be_managed_by_staff: true,
          },
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });
});

describe("checkWaiverAccess creator and signer", () => {
  test("allows the project creator", () => {
    expect(
      checkWaiverAccess(
        params({ currentUserId: "creator-user", orgMember: null }),
      ),
    ).toMatchObject({ hasPermission: true, reason: "organizer" });
  });

  test("allows the signer", () => {
    expect(
      checkWaiverAccess(
        params({ currentUserId: "signer-user", orgMember: null }),
      ),
    ).toMatchObject({ hasPermission: true, reason: "signer" });
  });
});

describe("checkWaiverAccess guest link", () => {
  const guestSignature = { user_id: null, anonymous_id: "guest-record" };

  test("allows a guest with the matching record and a validated token", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: null,
          orgMember: null,
          signature: guestSignature,
          anonymousSignupIdParam: "guest-record",
          anonymousAccessValidated: true,
        }),
      ),
    ).toMatchObject({ hasPermission: true, reason: "anonymous" });
  });

  test("lets a signed-in visitor open their own guest link", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: "someone-else",
          orgMember: null,
          signature: guestSignature,
          anonymousSignupIdParam: "guest-record",
          anonymousAccessValidated: true,
        }),
      ),
    ).toMatchObject({ hasPermission: true, reason: "anonymous" });
  });

  test("refuses a guest link whose token did not validate", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: "someone-else",
          orgMember: null,
          signature: guestSignature,
          anonymousSignupIdParam: "guest-record",
          anonymousAccessValidated: false,
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });

  test("refuses a validated token for a different guest record", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: null,
          orgMember: null,
          signature: guestSignature,
          anonymousSignupIdParam: "another-guest-record",
          anonymousAccessValidated: true,
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });

  test("a guest token never opens a signed-in user's waiver", () => {
    expect(
      checkWaiverAccess(
        params({
          currentUserId: null,
          orgMember: null,
          anonymousSignupIdParam: "guest-record",
          anonymousAccessValidated: true,
        }),
      ),
    ).toMatchObject({ hasPermission: false });
  });
});

describe("signed waiver file naming", () => {
  test("signed URLs live for minutes, not an hour", () => {
    expect(WAIVER_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(WAIVER_SIGNED_URL_TTL_SECONDS).toBeGreaterThanOrEqual(60);
  });

  test("the stored content type decides the served type", () => {
    expect(resolveWaiverContentType("image/jpeg", "a/b.pdf")).toBe(
      "image/jpeg",
    );
    expect(resolveWaiverContentType("image/png; charset=binary", null)).toBe(
      "image/png",
    );
    expect(resolveWaiverContentType("application/pdf", "a/b.png")).toBe(
      "application/pdf",
    );
  });

  test("an unrecorded content type falls back to the stored extension", () => {
    expect(resolveWaiverContentType("", "a/b.PNG")).toBe("image/png");
    expect(resolveWaiverContentType(null, "a/b.jpeg")).toBe("image/jpeg");
    expect(resolveWaiverContentType("application/octet-stream", "a/b")).toBe(
      "application/pdf",
    );
    // Nothing a stored object claims can make the route serve active content.
    expect(resolveWaiverContentType("text/html", "a/b.html")).toBe(
      "application/pdf",
    );
  });

  test("the download name carries the extension of the file served", () => {
    expect(getContentDisposition(false, "abc", "image/jpeg")).toBe(
      'attachment; filename="signed-waiver-abc.jpg"',
    );
    expect(getContentDisposition(false, "abc", "image/png")).toBe(
      'attachment; filename="signed-waiver-abc.png"',
    );
    expect(getContentDisposition(false, "abc")).toBe(
      'attachment; filename="signed-waiver-abc.pdf"',
    );
    expect(getContentDisposition(true, "abc", "image/png")).toBe(
      'inline; filename="waiver-abc.png"',
    );
  });

  test("the id cannot break out of the header", () => {
    expect(getContentDisposition(false, 'a"\r\nX-Evil: 1')).toBe(
      'attachment; filename="signed-waiver-aX-Evil1.pdf"',
    );
  });
});
