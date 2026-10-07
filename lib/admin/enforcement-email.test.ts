import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import type { SendEmailResult } from "@/services/email";
import { settleEnforcementEmail } from "./enforcement-email";

test.each([
  ["accepted", "accepted"],
  ["skipped", "skipped"],
  ["definitive_failure", "not_accepted"],
  ["retryable_pre_send", "not_accepted"],
  ["unknown_outcome", "unknown"],
] as const)(
  "enforcement reports %s as %s without retry",
  async (outcome, expected) => {
    let calls = 0;
    const result = await settleEnforcementEmail(async () => {
      calls++;
      return { outcome } as SendEmailResult;
    });
    expect(result.emailDelivery).toBe(expected);
    expect(calls).toBe(1);
    expect(Boolean(result.warning)).toBe(outcome !== "accepted");
  },
);

test("unexpected dispatch exceptions remain unknown and hide raw provider details", async () => {
  const result = await settleEnforcementEmail(async () => {
    throw new Error("synthetic sensitive provider details");
  });
  expect(result.emailDelivery).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain("sensitive provider");
});

test("account actions keep successful domain changes when mail acceptance is unknown", () => {
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    const messages = [];
    mock.module("server-only", () => ({}));
    mock.module("./app/admin/server/auth", () => ({ checkSuperAdmin: async () => ({ isAdmin: true, userId: "admin" }) }));
    mock.module("./app/admin/server/shared", () => ({ createServerNotification: async () => {}, readBannedUntil: () => null }));
    mock.module("./emails/account-access-update", () => ({ default: () => null }));
    mock.module("./services/email", () => ({ sendEmail: async (input) => { messages.push(input); return { outcome: "unknown_outcome" }; } }));
    mock.module("./lib/supabase/admin", () => ({ getAdminClient: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      auth: { admin: {
        getUserById: async () => ({ data: { user: { email: "synthetic@local.test", app_metadata: {} } }, error: null }),
        updateUserById: async () => ({ data: { user: { updated_at: "synthetic-persisted-time" } }, error: null }),
      } },
    }) }));
    mock.module("./lib/supabase/delete-user-with-cleanup", () => ({
      deleteUserWithCleanup: async () => ({ phase: "completed", completedNow: true, operationId: "synthetic-operation" }),
      accountDeletionFailureMessage: () => "unexpected",
    }));
    const { updateUserAccessControl, deleteAndBlacklistUser } = await import("./app/admin/server/enforcement");
    const ban = await updateUserAccessControl({ userId: "target", status: "banned", reason: "Synthetic reason" });
    assert.equal(ban.data.status, "banned"); assert.equal(ban.emailDelivery, "unknown"); assert.ok(ban.warning);
    const unban = await updateUserAccessControl({ userId: "target", status: "active" });
    assert.equal(unban.data.status, "active"); assert.equal(unban.emailDelivery, "unknown");
    const removal = await deleteAndBlacklistUser({ userId: "target" });
    assert.equal(removal.success, true); assert.equal(removal.emailDelivery, "unknown");
    assert.equal(messages.length, 3);
    assert.equal(messages[1].idempotencyKey, "account-access/target/synthetic-persisted-time/active");
    assert.equal(messages[2].idempotencyKey, "account-removal/synthetic-operation");
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
