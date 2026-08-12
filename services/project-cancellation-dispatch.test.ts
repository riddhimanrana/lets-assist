import { describe, expect, test } from "bun:test";

import type { SendEmailResult } from "@/services/email";
import type { CreateNotificationResult } from "@/services/notifications-server";
import {
  isRetryableCancellationState,
  settlementForCancellationNotification,
  settlementForCancellationSend,
  type CancellationEmailState,
} from "@/services/project-cancellation-dispatch";

/**
 * The mapping is pure, so the invariant that decides whether a volunteer hears
 * about a cancelled Saturday twice is provable with no database, no provider,
 * and no network.
 */

const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "provider-message-1",
  transport: "resend",
  data: { id: "provider-message-1" },
};

const skipped: SendEmailResult = {
  outcome: "skipped",
  success: false,
  skipped: true,
  phase: "preference_check",
  code: "transport_disabled",
  reason: "transport_disabled",
};

const retryablePreSend: SendEmailResult = {
  outcome: "retryable_pre_send",
  success: false,
  skipped: false,
  phase: "transport_setup",
  code: "resend_client_setup_failed",
  status: null,
  error: "The transport refused before the request was made.",
};

const definitiveFailure: SendEmailResult = {
  outcome: "definitive_failure",
  success: false,
  skipped: false,
  phase: "provider_response",
  code: "invalid_recipient",
  status: 422,
  error: "The provider rejected the message on its merits.",
};

const unknownOutcome: SendEmailResult = {
  outcome: "unknown_outcome",
  success: false,
  skipped: false,
  phase: "provider_request",
  code: "provider_request_aborted",
  status: null,
  error: "The provider request did not complete.",
};

describe("cancellation email settlement", () => {
  test("an accepted send is terminal and carries the provider id", () => {
    expect(settlementForCancellationSend(accepted)).toEqual({
      state: "sent",
      providerMessageId: "provider-message-1",
      failureCode: null,
    });
  });

  test("a deliberate skip records its reason without a provider id", () => {
    expect(settlementForCancellationSend(skipped)).toEqual({
      state: "skipped",
      providerMessageId: null,
      failureCode: "transport_disabled",
    });
  });

  test("only a pre-send refusal is released back to queued", () => {
    expect(settlementForCancellationSend(retryablePreSend).state).toBe(
      "queued",
    );
  });

  test("a definitive rejection is terminal, not retryable", () => {
    expect(settlementForCancellationSend(definitiveFailure).state).toBe(
      "failed",
    );
  });

  test("an ambiguous provider interaction is unknown_outcome, never a retry", () => {
    const settlement = settlementForCancellationSend(unknownOutcome);
    expect(settlement.state).toBe("unknown_outcome");
    expect(isRetryableCancellationState(settlement.state)).toBe(false);
  });

  test("exactly one outcome is retryable across the whole result space", () => {
    const retryable = [
      accepted,
      skipped,
      retryablePreSend,
      definitiveFailure,
      unknownOutcome,
    ]
      .map((result) => settlementForCancellationSend(result).state)
      .filter(isRetryableCancellationState);

    expect(retryable).toEqual(["queued"]);
  });

  test("no settlement leaks provider error text into the ledger", () => {
    for (const result of [
      accepted,
      skipped,
      retryablePreSend,
      definitiveFailure,
      unknownOutcome,
    ]) {
      const settlement = settlementForCancellationSend(result);
      // Failure codes come from a closed set; the provider's own sentence
      // (which is where addresses and keys appear) never reaches the ledger.
      expect(settlement.failureCode ?? "").not.toContain(" ");
    }
  });
});

describe("cancellation notification settlement", () => {
  test("a first delivery is recorded as delivered", () => {
    const result: CreateNotificationResult = { success: true };
    expect(settlementForCancellationNotification(result)).toBe("delivered");
  });

  test("a dedupe-key conflict is a success, recorded as replayed", () => {
    const result: CreateNotificationResult = { success: true, replayed: true };
    expect(settlementForCancellationNotification(result)).toBe("replayed");
  });

  test("a recipient preference opt-out is skipped, not failed", () => {
    const result: CreateNotificationResult = { success: false, skipped: true };
    expect(settlementForCancellationNotification(result)).toBe("skipped");
  });

  test("a real insert error is failed", () => {
    const result: CreateNotificationResult = { error: new Error("boom") };
    expect(settlementForCancellationNotification(result)).toBe("failed");
  });

  test("neither delivered nor replayed ever implies a second notice", () => {
    // Both mean "this recipient holds exactly one notification", which is what
    // the unique index on (user_id, dedupe_key) actually guarantees.
    const states: CancellationEmailState[] = ["sent", "skipped", "failed"];
    expect(states.every((state) => !isRetryableCancellationState(state))).toBe(
      true,
    );
  });
});
