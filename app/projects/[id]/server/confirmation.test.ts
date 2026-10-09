import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SendEmailResult } from "@/services/email";

const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "synthetic-message",
  transport: "mailpit",
  data: { id: "synthetic-message" },
};
const deliveries: SendEmailResult[] = [
  accepted,
  {
    outcome: "skipped",
    success: false,
    skipped: true,
    phase: "transport_setup",
    code: "transport_not_configured",
    reason: "Synthetic disabled transport",
  },
  {
    outcome: "definitive_failure",
    success: false,
    skipped: false,
    phase: "provider_response",
    code: "rejected",
    status: 422,
    error: "Synthetic rejection",
  },
  {
    outcome: "retryable_pre_send",
    success: false,
    skipped: false,
    phase: "transport_setup",
    code: "setup_failed",
    status: null,
    error: "Synthetic setup failure",
  },
  {
    outcome: "unknown_outcome",
    success: false,
    skipped: false,
    phase: "provider_request",
    code: "unknown",
    status: null,
    error: "Synthetic ambiguity",
  },
];
let token = "original-token";
let exists = true;
let confirmed = false;
let conflict = false;
const writes: string[] = [];
const sendEmail = mock(async (): Promise<SendEmailResult> => accepted);
const from = (table: string) => {
  let write: { token: string } | undefined;
  const conditions: Record<string, unknown> = {};
  const settle = () => {
    if (table === "projects")
      return { data: { title: "Synthetic project" }, error: null };
    if (table === "project_signups") return { data: null, error: null };
    if (write) {
      if (conflict || conditions.token !== token || confirmed)
        return { data: null, error: null };
      token = write.token;
      writes.push(token);
      return { data: { id: "synthetic-signup" }, error: null };
    }
    return {
      data: exists
        ? {
            id: "synthetic-signup",
            email: "synthetic@example.test",
            name: "Synthetic",
            project_id: "synthetic-project",
            token,
            confirmed_at: confirmed ? "2099-01-01" : null,
          }
        : null,
      error: null,
    };
  };
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      conditions[key] = value;
      return query;
    },
    is: (key: string, value: unknown) => {
      conditions[key] = value;
      return query;
    },
    update: (value: { token: string }) => {
      write = value;
      return query;
    },
    order: () => query,
    limit: () => query,
    single: async () => settle(),
    maybeSingle: async () => settle(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(settle()).then(resolve),
  };
  return query;
};
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from,
    rpc: async () => ({ data: [{ allowed: true }], error: null }),
  }),
}));
mock.module("@/services/email", () => ({ sendEmail }));
mock.module("@/emails/anonymous-signup-confirmation", () => ({
  default: () => null,
}));
mock.module("@/app/projects/[id]/server/shared", () => ({
  validateAnonymousSignupCaptcha: async () => ({}),
  getRequestMetadata: async () => ({ ipAddress: "192.0.2.1" }),
  getScheduleDetails: () => ({}),
  siteUrl: "https://example.test",
}));
const { resendAnonymousConfirmationEmail } = await import("./confirmation");
beforeEach(() => {
  token = "original-token";
  exists = true;
  confirmed = false;
  conflict = false;
  writes.length = 0;
  sendEmail.mockClear();
  sendEmail.mockImplementation(async () => accepted);
});
afterAll(() => mock.restore());
describe("anonymous confirmation delivery", () => {
  for (const delivery of deliveries)
    test(delivery.outcome, async () => {
      sendEmail.mockImplementation(async () => delivery);
      const result = await resendAnonymousConfirmationEmail(
        "synthetic-signup",
        "synthetic-captcha",
      );
      expect(result.success === true).toBe(delivery.outcome === "accepted");
      const keepNewToken = ["accepted", "unknown_outcome"].includes(
        delivery.outcome,
      );
      expect(token === "original-token").toBe(!keepNewToken);
      expect(writes.length).toBe(keepNewToken ? 1 : 2);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(
            /^anonymous-confirmation\/synthetic-signup\//,
          ),
        }),
      );
    });
  test("unexpected provider failure retains a potentially delivered link", async () => {
    sendEmail.mockImplementation(async () => {
      throw new Error("private-provider-data");
    });
    const result = await resendAnonymousConfirmationEmail("synthetic-signup");
    expect(result.success).not.toBe(true);
    expect(token).not.toBe("original-token");
    expect(JSON.stringify(result)).not.toContain("private-provider-data");
  });
  test("a concurrent confirmation or token change stops dispatch", async () => {
    conflict = true;
    const result = await resendAnonymousConfirmationEmail("synthetic-signup");
    expect(result.success).not.toBe(true);
    expect(writes).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  for (const state of ["missing", "confirmed"])
    test(`${state} signup remains non-enumerating`, async () => {
      exists = state !== "missing";
      confirmed = state === "confirmed";
      expect(
        await resendAnonymousConfirmationEmail("synthetic-signup"),
      ).toEqual({ success: true });
      expect(sendEmail).not.toHaveBeenCalled();
    });
});
