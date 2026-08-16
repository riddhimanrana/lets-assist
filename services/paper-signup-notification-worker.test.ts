import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { paperSignupNotificationSettlement } =
  await import("./paper-signup-notification-worker");

describe("paper signup notification settlement", () => {
  test("preserves provider identity only for accepted sends", () => {
    expect(
      paperSignupNotificationSettlement({
        outcome: "accepted",
        success: true,
        skipped: false,
        phase: "provider_response",
        messageId: "synthetic-message",
        transport: "resend",
        data: { id: "synthetic-message" },
      }),
    ).toEqual({
      outcome: "accepted",
      providerMessageId: "synthetic-message",
      safeCode: null,
    });
  });

  test("keeps safe retry and unknown outcomes distinct", () => {
    expect(
      paperSignupNotificationSettlement({
        outcome: "retryable_pre_send",
        success: false,
        skipped: false,
        phase: "transport_setup",
        code: "synthetic_pre_send",
        status: 429,
        error: "synthetic",
      }),
    ).toEqual({
      outcome: "retryable_pre_send",
      providerMessageId: null,
      safeCode: "synthetic_pre_send",
    });

    expect(
      paperSignupNotificationSettlement({
        outcome: "unknown_outcome",
        success: false,
        skipped: false,
        phase: "provider_request",
        code: "synthetic_unknown",
        status: null,
        error: "synthetic",
      }),
    ).toEqual({
      outcome: "unknown_outcome",
      providerMessageId: null,
      safeCode: "synthetic_unknown",
    });
  });
});
