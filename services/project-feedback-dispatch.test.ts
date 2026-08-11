import { describe, expect, test } from "bun:test";

import type { SendEmailResult } from "@/services/email";
import { settlementForSendResult } from "./project-feedback-dispatch";

function result(partial: Record<string, unknown>): SendEmailResult {
  return partial as unknown as SendEmailResult;
}

describe("settlementForSendResult", () => {
  test("accepted settles as sent with the provider id", () => {
    expect(
      settlementForSendResult(
        result({ outcome: "accepted", messageId: "msg-1" }),
      ),
    ).toEqual({ state: "sent", providerMessageId: "msg-1", failureCode: null });
  });

  test("skipped settles as skipped with the reason", () => {
    expect(
      settlementForSendResult(
        result({ outcome: "skipped", reason: "notifications_disabled" }),
      ),
    ).toEqual({
      state: "skipped",
      providerMessageId: null,
      failureCode: "notifications_disabled",
    });
  });

  test("retryable_pre_send releases back to queued", () => {
    expect(
      settlementForSendResult(
        result({ outcome: "retryable_pre_send", code: "rate_limit_exceeded" }),
      ).state,
    ).toBe("queued");
  });

  test("definitive_failure settles as failed", () => {
    expect(
      settlementForSendResult(
        result({ outcome: "definitive_failure", code: "invalid_recipient" }),
      ).state,
    ).toBe("failed");
  });

  test("unknown_outcome is terminal — never retryable", () => {
    const settlement = settlementForSendResult(
      result({ outcome: "unknown_outcome", code: "transport_error" }),
    );
    expect(settlement.state).toBe("unknown_outcome");
  });

  test("no outcome ever maps unknown_outcome to a retryable state", () => {
    const outcomes: Array<SendEmailResult["outcome"]> = [
      "accepted",
      "skipped",
      "retryable_pre_send",
      "definitive_failure",
      "unknown_outcome",
    ];
    for (const outcome of outcomes) {
      const settlement = settlementForSendResult(
        result({ outcome, code: "x", reason: "y", messageId: "z" }),
      );
      if (outcome === "unknown_outcome") {
        expect(settlement.state).not.toBe("queued");
        expect(settlement.state).toBe("unknown_outcome");
      }
      // Only the explicitly pre-send-retryable outcome may requeue.
      if (settlement.state === "queued") {
        expect(outcome).toBe("retryable_pre_send");
      }
    }
  });
});
