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

export type HoursSettlementAttemptResult = {
  data: boolean | null;
  error: { code?: string } | null;
};

export type HoursSettlementRetryResult = {
  settled: boolean;
  attempts: number;
  errorCode: string | null;
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

/**
 * Settlement is claim-token idempotent in SQL, so a lost successful response
 * can be retried without changing the recorded provider outcome.
 */
export async function settleHoursDeliveryWithRetry(
  attempt: () => Promise<HoursSettlementAttemptResult>,
  options: {
    maxAttempts?: number;
    pause?: (attemptNumber: number) => Promise<void>;
  } = {},
): Promise<HoursSettlementRetryResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("Settlement attempts must be an integer between 1 and 5");
  }

  let errorCode: string | null = null;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      const result = await attempt();
      if (!result.error && result.data === true) {
        return { settled: true, attempts: attemptNumber, errorCode: null };
      }

      errorCode = result.error?.code ?? "settlement_not_confirmed";
    } catch (error) {
      errorCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "settlement_transport_error";
    }

    if (attemptNumber < maxAttempts) {
      await options.pause?.(attemptNumber);
    }
  }

  return { settled: false, attempts: maxAttempts, errorCode };
}
