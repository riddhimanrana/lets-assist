/**
 * Decides what the "Add an email" form shows after a verification code was
 * requested. A send the provider accepted and a send whose delivery could not
 * be confirmed both move to code entry, because in both cases a valid code may
 * be in the inbox. Only a definite failure stays on the form.
 */
export type AddEmailOutcome =
  | { step: "code_entry"; delivery: "sent" }
  | { step: "code_entry"; delivery: "unconfirmed"; notice: string }
  | { step: "error"; tone: "error" | "warning"; message: string };

export const UNCONFIRMED_DELIVERY_NOTICE =
  "We could not confirm the email was sent. If a code arrives, enter it here, or send a new one.";

export function resolveAddEmailOutcome(result: {
  error?: string;
  warning?: unknown;
  deliveryUnconfirmed?: boolean;
  notice?: string;
}): AddEmailOutcome {
  if (result.error) {
    return {
      step: "error",
      tone: result.warning ? "warning" : "error",
      message: result.error,
    };
  }
  if (result.deliveryUnconfirmed) {
    return {
      step: "code_entry",
      delivery: "unconfirmed",
      notice: result.notice || UNCONFIRMED_DELIVERY_NOTICE,
    };
  }
  return { step: "code_entry", delivery: "sent" };
}
