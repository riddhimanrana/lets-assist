import type { SendEmailResult } from "@/services/email";

export type EnforcementEmailState = {
  emailDelivery:
    "accepted" | "skipped" | "not_accepted" | "unknown" | "not_attempted";
  warning?: string;
};

/** Email acceptance is separate from the already-committed account change. */
export async function settleEnforcementEmail(
  send: () => Promise<SendEmailResult>,
): Promise<EnforcementEmailState> {
  try {
    const result = await send();
    if (result.outcome === "accepted") return { emailDelivery: "accepted" };
    if (result.outcome === "skipped")
      return {
        emailDelivery: "skipped",
        warning: "Account change saved. The email was skipped.",
      };
    if (result.outcome !== "unknown_outcome")
      return {
        emailDelivery: "not_accepted",
        warning: "Account change saved. The email was not accepted.",
      };
  } catch {
    // An unexpected exception cannot prove that dispatch never started.
  }
  return {
    emailDelivery: "unknown",
    warning:
      "Account change saved. Email acceptance is unknown. Check the provider record before resending.",
  };
}
