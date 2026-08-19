import type { SendEmailResult } from "@/services/email";
import type { CreateNotificationResult } from "@/services/notifications-server";

/** Database email outcomes. Only retryable_pre_send may become queued again. */
export type CancellationEmailOutcome =
  "accepted" | "retryable_pre_send" | "failed" | "unknown_outcome";

/** Notification retries are safe because (user_id, dedupe_key) is unique. */
export type CancellationNotificationOutcome =
  "delivered" | "replayed" | "retryable" | "failed";

export type CancellationEmailSettlement = {
  outcome: CancellationEmailOutcome;
  providerMessageId: string | null;
  failureCode: string | null;
};

export function settlementForCancellationSend(
  result: SendEmailResult,
): CancellationEmailSettlement {
  switch (result.outcome) {
    case "accepted":
      return {
        outcome: "accepted",
        providerMessageId: result.messageId,
        failureCode: null,
      };
    case "retryable_pre_send":
      return {
        outcome: "retryable_pre_send",
        providerMessageId: null,
        failureCode: result.code,
      };
    case "unknown_outcome":
      return {
        outcome: "unknown_outcome",
        providerMessageId: null,
        failureCode: result.code,
      };
    case "definitive_failure":
      return {
        outcome: "failed",
        providerMessageId: null,
        failureCode: result.code,
      };
    case "skipped":
      // Cancellation mail is obligatory for a frozen eligible destination.
      // Disabled/missing transport therefore means failure, never completion.
      return {
        outcome: "failed",
        providerMessageId: null,
        failureCode: result.code,
      };
  }
}

export function settlementForCancellationNotification(
  result: CreateNotificationResult,
): CancellationNotificationOutcome {
  if ("error" in result) return "retryable";
  if (result.success === false) return "failed";
  return result.replayed ? "replayed" : "delivered";
}

export function isRetryableCancellationOutcome(
  outcome: CancellationEmailOutcome,
): boolean {
  return outcome === "retryable_pre_send";
}
