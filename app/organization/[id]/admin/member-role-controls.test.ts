import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { availableMemberRoleChanges } from "./member-role-controls";

describe("organization admin member role controls", () => {
  test("offers staff and member transitions only to an admin managing another account", () => {
    expect(
      availableMemberRoleChanges({
        actorRole: "admin",
        actorUserId: "admin-user",
        memberUserId: "staff-user",
        memberRole: "staff",
      }),
    ).toEqual(["member"]);
    expect(
      availableMemberRoleChanges({
        actorRole: "admin",
        actorUserId: "admin-user",
        memberUserId: "member-user",
        memberRole: "member",
      }),
    ).toEqual(["staff"]);
  });

  test("does not offer role changes for self-management or a non-admin actor", () => {
    expect(
      availableMemberRoleChanges({
        actorRole: "admin",
        actorUserId: "same-user",
        memberUserId: "same-user",
        memberRole: "staff",
      }),
    ).toEqual([]);
    expect(
      availableMemberRoleChanges({
        actorRole: "staff",
        actorUserId: "staff-user",
        memberUserId: "member-user",
        memberRole: "member",
      }),
    ).toEqual([]);
  });

  test("connects the admin menu to the existing authorized server action", () => {
    const source = readFileSync(
      new URL("./MembersClient.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('import { updateMemberRole } from "../actions"');
    expect(source).toContain(
      "updateMemberRole(organizationId, member.id, role)",
    );
    expect(source).toContain("Make Staff");
    expect(source).toContain("Make Member");
  });
});
