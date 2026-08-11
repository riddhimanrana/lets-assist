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

export type HoursEmailPayloadSnapshot = {
  version: 1;
  to: string;
  from: string;
  subject: string;
  html: string;
  tags: [
    { name: "workflow"; value: "volunteer-hours-publication" },
    { name: "receipt"; value: string },
  ];
};

export function parseHoursEmailPayloadSnapshot(
  value: unknown,
  receiptId: string,
): HoursEmailPayloadSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 6 ||
    candidate.version !== 1 ||
    typeof candidate.to !== "string" ||
    candidate.to.length < 1 ||
    candidate.to.length > 320 ||
    typeof candidate.from !== "string" ||
    candidate.from.length < 1 ||
    candidate.from.length > 500 ||
    typeof candidate.subject !== "string" ||
    candidate.subject.length < 1 ||
    candidate.subject.length > 998 ||
    typeof candidate.html !== "string" ||
    candidate.html.length < 1 ||
    candidate.html.length > 1_000_000 ||
    !Array.isArray(candidate.tags) ||
    candidate.tags.length !== 2
  ) {
    return null;
  }

  const [workflowTag, receiptTag] = candidate.tags;
  if (
    !workflowTag ||
    typeof workflowTag !== "object" ||
    Array.isArray(workflowTag) ||
    Object.keys(workflowTag).length !== 2 ||
    (workflowTag as Record<string, unknown>).name !== "workflow" ||
    (workflowTag as Record<string, unknown>).value !==
      "volunteer-hours-publication" ||
    !receiptTag ||
    typeof receiptTag !== "object" ||
    Array.isArray(receiptTag) ||
    Object.keys(receiptTag).length !== 2 ||
    (receiptTag as Record<string, unknown>).name !== "receipt" ||
    (receiptTag as Record<string, unknown>).value !== receiptId
  ) {
    return null;
  }

  return candidate as HoursEmailPayloadSnapshot;
}

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
