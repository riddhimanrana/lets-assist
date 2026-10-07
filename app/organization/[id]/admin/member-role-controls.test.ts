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

  test("connects the members row menu to the existing authorized server action", () => {
    const read = (path: string) =>
      readFileSync(new URL(path, import.meta.url), "utf8");
    const actions = read("../use-member-actions.ts");
    expect(actions).toContain(
      'import { removeMember, updateMemberRole } from "./actions"',
    );
    expect(actions).toContain(
      "updateMemberRole(organizationId, memberId, newRole)",
    );

    const menu = read("../MemberRowMenu.tsx");
    expect(menu).toContain("DropdownMenuRadioGroup");
    expect(menu).toContain("onUpdateRole(");
    expect(menu).toContain("MEMBER_ROLE_LABELS[role]");

    const tab = read("../MembersTab.tsx");
    expect(tab).toContain("onUpdateRole: handleUpdateRole");
  });

  test("the retired directory route redirects to the members tab", () => {
    const page = readFileSync(
      new URL("./members/page.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain("?tab=members");
    expect(page).not.toContain("MembersClient");
  });
});
