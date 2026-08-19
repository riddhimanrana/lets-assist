import type { SendEmailResult } from "@/services/email";

/**
 * Pure mapping from a SendEmailResult to the dispatch ledger's settlement
 * state (modelled on services/csf-communications-dispatch.ts).
 *
 * The one invariant that must never break: unknown_outcome NEVER maps to a
 * retryable state. An ambiguous provider interaction may have delivered the
 * email; retrying is how volunteers get the same survey twice.
 */

export type FeedbackRequestSettlement = {
  /** 'queued' releases the lease for a later retry; the rest are terminal. */
  state: "sent" | "skipped" | "failed" | "unknown_outcome" | "queued";
  providerMessageId: string | null;
  failureCode: string | null;
};

export function settlementForSendResult(
  result: SendEmailResult,
): FeedbackRequestSettlement {
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
      // The provider was never reached (or said try-later): safe to requeue.
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
