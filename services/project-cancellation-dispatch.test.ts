import { describe, expect, test } from "bun:test";

import type { SendEmailResult } from "@/services/email";
import {
  isRetryableCancellationOutcome,
  settlementForCancellationNotification,
  settlementForCancellationSend,
} from "@/services/project-cancellation-dispatch";

const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "provider-message-1",
  transport: "resend",
  data: { id: "provider-message-1" },
};

const retryable: SendEmailResult = {
  outcome: "retryable_pre_send",
  success: false,
  skipped: false,
  phase: "transport_setup",
  code: "resend_client_setup_failed",
  status: null,
  error: "transport setup failed",
};

const rejected: SendEmailResult = {
  outcome: "definitive_failure",
  success: false,
  skipped: false,
  phase: "provider_response",
  code: "invalid_recipient",
  status: 422,
  error: "provider rejected request",
};

const unknown: SendEmailResult = {
  outcome: "unknown_outcome",
  success: false,
  skipped: false,
  phase: "provider_request",
  code: "provider_request_aborted",
  status: null,
  error: "outcome unknown",
};

const missingTransport: SendEmailResult = {
  outcome: "skipped",
  success: false,
  skipped: true,
  phase: "transport_setup",
  code: "transport_disabled",
  reason: "transport_disabled",
};

describe("owed cancellation email truth", () => {
  test("provider acceptance records accepted plus the provider id", () => {
    expect(settlementForCancellationSend(accepted)).toEqual({
      outcome: "accepted",
      providerMessageId: "provider-message-1",
      failureCode: null,
    });
  });

  test("only a proven pre-send refusal is retryable", () => {
    const outcomes = [accepted, retryable, rejected, unknown, missingTransport]
      .map((result) => settlementForCancellationSend(result).outcome)
      .filter(isRetryableCancellationOutcome);
    expect(outcomes).toEqual(["retryable_pre_send"]);
  });

  test("missing transport and definitive rejection cannot look completed", () => {
    expect(settlementForCancellationSend(missingTransport).outcome).toBe(
      "failed",
    );
    expect(settlementForCancellationSend(rejected).outcome).toBe("failed");
  });

  test("unknown provider outcome is terminal and never retryable", () => {
    const outcome = settlementForCancellationSend(unknown).outcome;
    expect(outcome).toBe("unknown_outcome");
    expect(isRetryableCancellationOutcome(outcome)).toBe(false);
  });
});

describe("owed in-app notification truth", () => {
  test("insert and dedupe replay are both successful terminal truth", () => {
    expect(settlementForCancellationNotification({ success: true })).toBe(
      "delivered",
    );
    expect(
      settlementForCancellationNotification({ success: true, replayed: true }),
    ).toBe("replayed");
  });

  test("a transient insert error retries safely", () => {
    expect(
      settlementForCancellationNotification({ error: new Error("transient") }),
    ).toBe("retryable");
  });

  test("an impossible preference skip is failure, not completion", () => {
    expect(
      settlementForCancellationNotification({ success: false, skipped: true }),
    ).toBe("failed");
  });
});
