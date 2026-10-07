import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { SendEmailResult } from "@/services/email";
const report = {
  id: "11111111-1111-4111-8111-111111111111",
  reporter_id: "22222222-2222-4222-8222-222222222222",
  content_type: "project",
  content_id: "33333333-3333-4333-8333-333333333333",
  updated_at: "2026-10-07T00:00:00.000Z",
};
const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "synthetic",
  transport: "resend",
  data: { id: "synthetic" },
};
let emailResult: SendEmailResult = accepted;
let notificationResult:
  { success: boolean; skipped?: boolean } | { error: string } = {
  success: true,
};
let throwEmail = false;
const sent: Array<{ idempotencyKey?: string }> = [];
mock.module("@/services/email", () => ({
  sendEmail: async (params: { idempotencyKey?: string }) => {
    sent.push(params);
    if (throwEmail) throw new Error("Synthetic timeout");
    return emailResult;
  },
}));
mock.module("@/services/notifications-server", () => ({
  createNotificationForUser: async () => notificationResult,
}));
mock.module("@/lib/logger", () => ({ logInfo: () => {}, logError: () => {} }));
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: "synthetic-admin" } } }),
  },
  from: (table: string) => {
    let update: Record<string, unknown> | undefined;
    const result = () =>
      table === "content_reports"
        ? { data: [{ ...report, ...update }], error: null }
        : table === "profiles"
          ? {
              data: {
                id: report.reporter_id,
                full_name: "Synthetic Reporter",
                email: "synthetic@example.test",
              },
              error: null,
            }
          : {
              data: { id: report.content_id, title: "Synthetic Project" },
              error: null,
            };
    const query = {
      select: () => query,
      eq: () => query,
      update: (input: Record<string, unknown>) => {
        update = input;
        return query;
      },
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return query;
  },
};
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => supabase }));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));
mock.module("@/app/admin/actions", () => ({
  checkSuperAdmin: async () => ({ isAdmin: true }),
}));
const { updateContentReportStatus } = await import("./reports");
beforeEach(() => {
  emailResult = accepted;
  notificationResult = { success: true };
  throwEmail = false;
  sent.length = 0;
});
afterAll(() => mock.restore());

test("a saved report never claims mailbox delivery and uses the saved revision as send identity", async () => {
  const result = await updateContentReportStatus(report.id, "resolved");
  expect(result.message).toBe("Case resolved.");
  expect(result.notificationWarning).toBeUndefined();
  expect(sent[0].idempotencyKey).toMatch(
    new RegExp(`^report-update/${report.id}/`),
  );
});
for (const outcome of [
  "skipped",
  "definitive_failure",
  "retryable_pre_send",
  "unknown_outcome",
] as const)
  test(`saved report with ${outcome} and no in-app receipt reports unconfirmed notification`, async () => {
    notificationResult = { error: "Synthetic failure" };
    emailResult =
      outcome === "skipped"
        ? {
            outcome,
            success: false,
            skipped: true,
            phase: "preference_check",
            code: "synthetic",
            reason: "Synthetic optout",
          }
        : {
            outcome,
            success: false,
            skipped: false,
            phase: "provider_request",
            code: "synthetic",
            status: null,
            error: "Synthetic failure",
          };
    const result = await updateContentReportStatus(report.id, "resolved");
    expect(result.data?.id).toBe(report.id);
    expect(result.error).toBeUndefined();
    expect(result.notificationWarning).toContain("could not be confirmed");
    expect(result.message).not.toContain("Reporter was notified");
  });
test("an email exception does not undo or conceal the saved domain action", async () => {
  throwEmail = true;
  notificationResult = { error: "Synthetic failure" };
  const result = await updateContentReportStatus(report.id, "dismissed");
  expect(result.data?.status).toBe("dismissed");
  expect(result.notificationWarning).toContain("could not be confirmed");
});
test("honored opt-outs are distinct from failed delivery", async () => {
  notificationResult = { success: false, skipped: true };
  emailResult = {
    outcome: "skipped",
    success: false,
    skipped: true,
    phase: "preference_check",
    code: "synthetic",
    reason: "Synthetic optout",
  };
  const result = await updateContentReportStatus(report.id, "resolved");
  expect(result.notificationWarning).toContain("preferences");
});
test("a persisted in-app notification does not claim email success", async () => {
  emailResult = {
    outcome: "unknown_outcome",
    success: false,
    skipped: false,
    phase: "provider_request",
    code: "synthetic",
    status: null,
    error: "Synthetic timeout",
  };
  const result = await updateContentReportStatus(report.id, "resolved");
  expect(result.notificationWarning).toBeUndefined();
  expect(result.message).toBe("Case resolved.");
});
