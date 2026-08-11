import type { SendEmailResult } from "@/services/email";

export type HoursEmailSettlement = {
  state:
    | "accepted"
    | "retryable_failure"
    | "definitive_failure"
    | "unknown_outcome"
    | "skipped";
  providerMessageId: string | null;
  safeCode: string | null;
  accepted: boolean;
  partial: boolean;
};

export function hoursPublicationOutcome(
  databaseOutcome: "accepted" | "replayed",
  deliveryIsPartial: boolean,
): "accepted" | "replayed" | "partial" {
  return deliveryIsPartial ? "partial" : databaseOutcome;
}

/**
 * Convert the email transport's honest outcome into the durable hours outbox
 * vocabulary. In particular, provider ambiguity never becomes retryable work.
 */
export function hoursEmailSettlement(
  result: SendEmailResult,
): HoursEmailSettlement {
  switch (result.outcome) {
    case "accepted":
      return {
        state: "accepted",
        providerMessageId: result.messageId,
        safeCode: null,
        accepted: true,
        partial: false,
      };
    case "retryable_pre_send":
      return {
        state: "retryable_failure",
        providerMessageId: null,
        safeCode: result.code,
        accepted: false,
        partial: true,
      };
    case "definitive_failure":
      return {
        state: "definitive_failure",
        providerMessageId: null,
        safeCode: result.code,
        accepted: false,
        partial: true,
      };
    case "unknown_outcome":
      return {
        state: "unknown_outcome",
        providerMessageId: null,
        safeCode: result.code,
        accepted: false,
        partial: true,
      };
    case "skipped":
      return {
        state: "skipped",
        providerMessageId: null,
        safeCode: result.code,
        accepted: false,
        partial: true,
      };
  }
}
