import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("organization administration action modules", () => {
  test("the compatibility barrel preserves the invitation surface", () => {
    const barrel = read("app/organization/[id]/admin/actions.ts");
    for (const actionName of [
      "acceptInvitation",
      "bulkInviteMembers",
      "cancelInvitation",
      "deleteInvitations",
      "getInvitationByToken",
      "getOrganizationInvitations",
      "getOrganizationMembers",
      "resendInvitation",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/createClient|\.from\(/u);
  });

  test("all focused modules meet the action budget", () => {
    for (const path of [
      "app/organization/[id]/admin/server/acceptance.ts",
      "app/organization/[id]/admin/server/invitations.ts",
      "app/organization/[id]/admin/server/members.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
