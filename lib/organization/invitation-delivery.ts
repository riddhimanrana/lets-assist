import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendEmail,
  type SendEmailParams,
  type SendEmailResult,
} from "@/services/email";
import type {
  InvitationDeliveryStatus,
  InvitationDuration,
} from "./invitation-utils";

export type InvitationDeliveryResult =
  { success: true } | { success: false; error: string };
const UNKNOWN =
  "Invitation delivery is unconfirmed. Review the delivery record before resending.";

/** Persist send intent first. A pending attempt cannot be retried as a new send. */
async function runInvitationDelivery({
  supabase,
  invitationId,
  email,
  previousAttempt = null,
  previousDelivery = "pending",
  previousStatus = "pending",
  renewal,
  dispatch = sendEmail,
}: {
  supabase: SupabaseClient;
  invitationId: string;
  email: SendEmailParams;
  previousAttempt?: string | null;
  previousDelivery?: InvitationDeliveryStatus;
  previousStatus?: "pending" | "expired";
  renewal?: { invitation_duration: InvitationDuration; expires_at: string };
  dispatch?: typeof sendEmail;
}): Promise<InvitationDeliveryResult> {
  if (previousDelivery === "pending" && previousAttempt)
    return { success: false, error: UNKNOWN };
  const previousTime = previousAttempt ? Date.parse(previousAttempt) : 0;
  if (!Number.isFinite(previousTime)) return { success: false, error: UNKNOWN };
  const attemptedAt = new Date(
    Math.max(Date.now(), previousTime + 1),
  ).toISOString();
  let claim = supabase
    .from("organization_invitations")
    .update({
      ...renewal,
      status: "pending",
      email_delivery_status: "pending",
      email_delivery_error: null,
      last_email_attempt_at: attemptedAt,
    })
    .eq("id", invitationId)
    .eq("status", previousStatus)
    .eq("email_delivery_status", previousDelivery);
  claim = previousAttempt
    ? claim.eq("last_email_attempt_at", previousAttempt)
    : claim.is("last_email_attempt_at", null);
  const { data: claimed, error: claimError } = await claim
    .select("id")
    .maybeSingle();
  if (claimError || claimed?.id !== invitationId)
    return {
      success: false,
      error:
        "The invitation changed or its send could not be started. Refresh before retrying.",
    };

  let result: SendEmailResult;
  try {
    result = await dispatch({
      ...email,
      idempotencyKey: `organization-invitation/${invitationId}/${attemptedAt}`,
    });
  } catch {
    // The durable pending state prevents an ambiguous throw from resending.
    return { success: false, error: UNKNOWN };
  }
  const accepted = result.outcome === "accepted";
  const unknown = result.outcome === "unknown_outcome";
  const skipped = result.outcome === "skipped";
  const message = accepted
    ? null
    : unknown
      ? UNKNOWN
      : skipped
        ? "Invitation email was not sent. Check the email configuration before retrying."
        : "Invitation email was refused before acceptance. Check the delivery record before retrying.";
  const { data: settled, error: settleError } = await supabase
    .from("organization_invitations")
    .update({
      email_delivery_status: accepted
        ? "sent"
        : unknown
          ? "pending"
          : skipped
            ? "skipped"
            : "failed",
      email_delivery_error: message,
      last_email_sent_at: accepted ? attemptedAt : null,
      email_message_id: accepted ? result.messageId : null,
      email_transport: accepted ? result.transport : null,
    })
    .eq("id", invitationId)
    .eq("last_email_attempt_at", attemptedAt)
    .eq("email_delivery_status", "pending")
    .select("id")
    .maybeSingle();
  if (settleError || settled?.id !== invitationId)
    return { success: false, error: UNKNOWN };
  return accepted ? { success: true } : { success: false, error: message! };
}

export async function deliverInvitation(
  ...args: Parameters<typeof runInvitationDelivery>
): Promise<InvitationDeliveryResult> {
  try {
    return await runInvitationDelivery(...args);
  } catch {
    return { success: false, error: UNKNOWN };
  }
}
