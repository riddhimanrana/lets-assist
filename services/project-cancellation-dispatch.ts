import type { SendEmailResult } from "@/services/email";
import type { CreateNotificationResult } from "@/services/notifications-server";

/**
 * Pure mappings from a send result and a notification result to the
 * project_cancellation_deliveries state machine.
 *
 * Kept apart from the worker so the one rule that actually protects volunteers
 * is testable without a database, a provider, or a network:
 *
 *   unknown_outcome NEVER maps to a retryable state.
 *
 * An ambiguous provider interaction may already have delivered the cancellation
 * email. Retrying it is how someone learns twice that their Saturday was
 * called off. Only `retryable_pre_send` — refused before the request was ever
 * made — may go back to 'queued'.
 */

/** 'queued' releases the lease for a later attempt; every other state is terminal. */
export type CancellationEmailState =
  "sent" | "skipped" | "failed" | "unknown_outcome" | "queued";

export type CancellationNotificationState =
  "delivered" | "replayed" | "skipped" | "failed";

export type CancellationDeliverySettlement = {
  state: CancellationEmailState;
  providerMessageId: string | null;
  failureCode: string | null;
};

export function settlementForCancellationSend(
  result: SendEmailResult,
): CancellationDeliverySettlement {
  switch (result.outcome) {
    case "accepted":
      return {
        state: "sent",
        providerMessageId: result.messageId,
        failureCode: null,
      };
    case "skipped":
      return {
        state: "skipped",
        providerMessageId: null,
        failureCode: result.reason,
      };
    case "retryable_pre_send":
      // The provider was never reached (or refused before acceptance), so the
      // lease may be released without any chance of a duplicate.
      return {
        state: "queued",
        providerMessageId: null,
        failureCode: result.code,
      };
    case "definitive_failure":
      return {
        state: "failed",
        providerMessageId: null,
        failureCode: result.code,
      };
    case "unknown_outcome":
      return {
        state: "unknown_outcome",
        providerMessageId: null,
        failureCode: result.code,
      };
  }
}

/**
 * The in-app notice is idempotent by construction: the deterministic dedupe key
 * carries a unique index per recipient, so a replay is a success the worker can
 * record rather than an error it has to suppress. 'replayed' and 'delivered'
 * therefore both mean "this person has exactly one cancellation notice".
 */
export function settlementForCancellationNotification(
  result: CreateNotificationResult,
): CancellationNotificationState {
  if ("error" in result) return "failed";
  if (result.success === false) return "skipped";
  return result.replayed ? "replayed" : "delivered";
}

/**
 * Whether a settled email state leaves the recipient reachable by a later run.
 * Exposed so the worker's counters and the route's aggregate response cannot
 * describe an ambiguous send as a retry.
 */
export function isRetryableCancellationState(
  state: CancellationEmailState,
): boolean {
  return state === "queued";
}
