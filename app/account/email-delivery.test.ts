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
const outcomes: SendEmailResult[] = [
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
const sendEmail = mock(async (): Promise<SendEmailResult> => accepted);
const rpc = mock(async (name: string) => {
  if (name === "issue_user_email_alias_verification") {
    return {
      data: [{ status: "issued", challenge_id: "synthetic-challenge" }],
      error: null,
    };
  }
  if (name === "discard_user_email_alias_verification")
    return { data: null, error: null };
  throw new Error("Unexpected RPC in fixture");
});
const getAuthUser = mock(async () => ({
  user: { id: "synthetic-user" },
  error: null,
}));
mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc }),
}));
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}));
mock.module("@/lib/supabase/auth-helpers", () => ({ getAuthUser }));
mock.module("@/lib/auth/email-alias-verification", () => ({
  EMAIL_ALIAS_CODE_TTL_MS: 1800000,
  generateEmailAliasVerificationCode: () => "123456",
  hashEmailAliasVerificationCode: () => "synthetic-hash",
  normalizeEmailAlias: (value: string) => value.toLowerCase(),
}));
mock.module("@/lib/auth/primary-email", () => ({
  syncPrimaryUserEmail: async () => ({}),
}));
mock.module("@/app/signup/canonical-auth-request", () => ({
  runOnCanonicalAuthOrigin: async () => ({}),
}));
mock.module("@/services/email", () => ({ sendEmail }));
mock.module("@/emails/email-verification-code", () => ({
  default: () => null,
}));
mock.module("@/emails/certificate-published", () => ({ default: () => null }));

const { sendVerificationEmail } = await import("./email-actions");
const { sendCertificatePublishedEmails } =
  await import("../projects/[id]/hours/certificate-issuance");

beforeEach(() => {
  rpc.mockClear();
  sendEmail.mockClear();
  getAuthUser.mockClear();
  sendEmail.mockImplementation(async () => accepted);
});
afterAll(() => mock.restore());

describe("mail callers require provider acceptance", () => {
  for (const outcome of outcomes) {
    test(`alias verification handles ${outcome.outcome} honestly`, async () => {
      sendEmail.mockImplementation(async () => outcome);
      const result = await sendVerificationEmail("synthetic@example.test");
      expect(result.success === true).toBe(outcome.outcome === "accepted");
      // Only an ambiguous send is flagged for code entry, and it carries no
      // error so the caller does not treat it as a failure.
      const ambiguous = outcome.outcome === "unknown_outcome";
      expect(result.deliveryUnconfirmed === true).toBe(ambiguous);
      expect(typeof result.error === "string").toBe(
        !ambiguous && outcome.outcome !== "accepted",
      );
      const discardCalls = rpc.mock.calls.filter(
        ([name]) => name === "discard_user_email_alias_verification",
      );
      expect(discardCalls.length).toBe(
        ["skipped", "definitive_failure", "retryable_pre_send"].includes(
          outcome.outcome,
        )
          ? 1
          : 0,
      );
      expect(getAuthUser).toHaveBeenCalledWith({
        sensitive: true,
        checkMfa: true,
      });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: "email-alias-verification/synthetic-challenge",
        }),
      );
    });
    test(`certificate counters handle ${outcome.outcome} honestly`, async () => {
      sendEmail.mockImplementation(async () => outcome);
      const result = await sendCertificatePublishedEmails([
        {
          id: "synthetic-certificate",
          volunteer_name: "Synthetic Volunteer",
          volunteer_email: "synthetic@example.test",
          project_title: "Synthetic Project",
        },
      ]);
      expect(result.emailsSent).toBe(outcome.outcome === "accepted" ? 1 : 0);
      expect(result.success).toBe(outcome.outcome === "accepted");
      expect(result.errors.length).toBe(outcome.outcome === "accepted" ? 0 : 1);
    });
  }
  test("an unexpected send exception preserves the potentially delivered verification code", async () => {
    sendEmail.mockImplementation(async () => {
      throw new Error("private-provider-payload");
    });
    const result = await sendVerificationEmail("synthetic@example.test");
    expect(result.success).not.toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.deliveryUnconfirmed).toBe(true);
    expect(result.notice).toBe(
      "We could not confirm the email was sent. If a code arrives, enter it here, or send a new one.",
    );
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === "discard_user_email_alias_verification",
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("private-provider-payload");
  });
  test("an ambiguous send keeps the challenge, the retry window, and the honest notice", async () => {
    sendEmail.mockImplementation(async () => outcomes[4]);
    const result = await sendVerificationEmail("synthetic@example.test");
    expect(result).toEqual({
      deliveryUnconfirmed: true,
      notice:
        "We could not confirm the email was sent. If a code arrives, enter it here, or send a new one.",
      retryAfterSeconds: 60,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "issue_user_email_alias_verification",
    ]);
  });
  test("a definite failure discards the challenge and offers no code entry", async () => {
    sendEmail.mockImplementation(async () => outcomes[2]);
    const result = await sendVerificationEmail("synthetic@example.test");
    expect(result).toEqual({ error: "Unable to send a verification code." });
  });
  test("a cooldown is still an error, not an ambiguous delivery", async () => {
    rpc.mockImplementationOnce(async () => ({
      data: [
        {
          status: "cooldown",
          challenge_id: "unused",
          retry_after_seconds: 42,
        },
      ] as unknown as { status: string; challenge_id: string }[],
      error: null,
    }));
    const result = await sendVerificationEmail("synthetic@example.test");
    expect(result).toEqual({
      error: "Please wait before requesting another verification code.",
      retryAfterSeconds: 42,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
