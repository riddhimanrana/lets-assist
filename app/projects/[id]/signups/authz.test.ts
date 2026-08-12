import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "@/lib/projects/management-access";

/**
 * The signups surface reads its roster with the admin client, so its gate is
 * the only thing standing between an organization member and a project's
 * volunteer contact details. It must therefore apply exactly the policy that
 * gates moderating the roster: canManageProjectAccess plus an active
 * membership. The structural tests pin the call sites so a future edit cannot
 * quietly reintroduce a role-name shortcut; the decision table pins what that
 * policy actually decides.
 */

const rosterLoaderSource = readFileSync(
  join(import.meta.dir, "actions.ts"),
  "utf8",
);
const cancellationSource = readFileSync(
  join(import.meta.dir, "../server/cancellation.ts"),
  "utf8",
);

const CREATOR = "creator-1";
const OTHER = "user-2";

function canReadRoster(input: {
  role?: string | null;
  status?: string | null;
  canBeManagedByStaff?: boolean | null;
}) {
  return canManageProjectAccess({
    creatorId: CREATOR,
    userId: OTHER,
    organizationRole: activeOrganizationRole(
      input.role === undefined
        ? null
        : { role: input.role, status: input.status },
    ),
    canBeManagedByStaff: input.canBeManagedByStaff ?? null,
  });
}

describe("organizer roster loader authorization", () => {
  test("gates the admin-client read on the canonical policy", () => {
    expect(rosterLoaderSource).toContain("getAdminClient");
    expect(rosterLoaderSource).toContain("canManageProjectAccess({");
    expect(rosterLoaderSource).toContain("activeOrganizationRole(orgMember)");
  });

  test("selects the staff flag and the membership status it decides on", () => {
    expect(rosterLoaderSource).toContain(
      '"id, creator_id, organization_id, can_be_managed_by_staff"',
    );
    expect(rosterLoaderSource).toContain('.select("role, status")');
  });

  test("keeps no role-name shortcut that would bypass the staff flag", () => {
    expect(rosterLoaderSource).not.toContain('["admin", "staff"]');
    expect(rosterLoaderSource).not.toMatch(/role\s*===\s*["']staff["']/u);
  });

  test("rejection leaves the decision to the server transaction", () => {
    expect(cancellationSource).toContain(
      'supabase.rpc("reject_project_signup"',
    );
    expect(cancellationSource).toContain("p_signup_id: signupId");
    expect(cancellationSource).not.toContain("p_expected_user_id");
    expect(cancellationSource).not.toContain("p_expected_project_id");
    expect(cancellationSource).not.toMatch(/status:\s*["']rejected["']/u);
  });

  test("the compatibility notification action cannot address a recipient", () => {
    expect(cancellationSource).not.toMatch(
      /from\s+["']@\/services\/notifications(?:-server)?["']/u,
    );
    expect(cancellationSource).toMatch(
      /createRejectionNotification\([\s\S]*?return rejectSignupTransactionally\(signupId\)/u,
    );
  });
});

describe("who may read a project's signup roster", () => {
  test("the creator may, with no membership at all", () => {
    expect(
      canManageProjectAccess({
        creatorId: CREATOR,
        userId: CREATOR,
        organizationRole: null,
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("an active org admin may, regardless of the staff flag", () => {
    expect(canReadRoster({ role: "admin", status: "active" })).toBe(true);
    expect(
      canReadRoster({
        role: "admin",
        status: "active",
        canBeManagedByStaff: false,
      }),
    ).toBe(true);
  });

  test("active staff may only while the project opted in", () => {
    expect(
      canReadRoster({
        role: "staff",
        status: "active",
        canBeManagedByStaff: true,
      }),
    ).toBe(true);
    expect(
      canReadRoster({
        role: "staff",
        status: "active",
        canBeManagedByStaff: false,
      }),
    ).toBe(false);
    expect(canReadRoster({ role: "staff", status: "active" })).toBe(false);
  });

  test("a membership that is not active may not, whatever its role", () => {
    for (const status of ["invited", "inactive", "pending", null]) {
      expect(
        canReadRoster({ role: "admin", status, canBeManagedByStaff: true }),
      ).toBe(false);
      expect(
        canReadRoster({ role: "staff", status, canBeManagedByStaff: true }),
      ).toBe(false);
    }
  });

  test("plain members and non-members may not", () => {
    expect(
      canReadRoster({
        role: "member",
        status: "active",
        canBeManagedByStaff: true,
      }),
    ).toBe(false);
    expect(canReadRoster({ canBeManagedByStaff: true })).toBe(false);
  });
});
