import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("platform administration action modules", () => {
  test("the compatibility barrel preserves every public action", () => {
    const barrel = read("app/admin/actions.ts");
    for (const actionName of [
      "addTrustedMember",
      "checkSuperAdmin",
      "deleteAndBlacklistUser",
      "deleteFeedback",
      "getAllFeedback",
      "getOrganizationsForAdmin",
      "getTrustedMemberApplications",
      "getUserAccessControl",
      "searchUsers",
      "sendSystemNotification",
      "updateFeedbackModerationStatus",
      "updateOrganizationVerifiedStatus",
      "updateTrustedMemberStatus",
      "updateUserAccessControl",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("all focused action modules meet the service budget", () => {
    for (const path of [
      "app/admin/server/auth.ts",
      "app/admin/server/notifications.ts",
      "app/admin/server/feedback.ts",
      "app/admin/server/trusted-members.ts",
      "app/admin/server/enforcement.ts",
      "app/admin/server/organizations.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
