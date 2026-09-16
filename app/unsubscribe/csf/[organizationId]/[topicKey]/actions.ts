"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import * as React from "react";
import { z } from "zod";

import CsfUnsubscribeConfirm from "@/emails/csf-unsubscribe-confirm";
import { getInvitationBaseUrl } from "@/lib/organization/invitation-utils";
import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/services/email-send";
import { createCsfUnsubscribeToken } from "@/services/csf-unsubscribe-token";

/**
 * Step one of the verify-the-address unsubscribe loop.
 *
 * THE RESPONSE IS CONSTANT ON PURPOSE. Whatever the visitor types — a member's
 * address, a stranger's, or gibberish past validation — the page says the same
 * thing, so this form is not an oracle for who receives chapter mail.
 * Internally a confirmation email is sent only when the address has actually
 * appeared in this chapter's recipient snapshots: our sender identity cannot
 * be used to spray confirmation mail at arbitrary strangers.
 */

export type CsfUnsubscribeRequestState = {
  submitted: boolean;
  error?: string;
};

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  topicKey: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$/)
    .refine((value) => value !== "transactional"),
  email: z.string().trim().toLowerCase().email().max(320),
});

const NEUTRAL_RESPONSE: CsfUnsubscribeRequestState = { submitted: true };

const RATE_WINDOW_SECONDS = 60 * 60;
const IP_LIMIT_PER_HOUR = 10;
const ADDRESS_LIMIT_PER_HOUR = 3;

function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function consumeBucket(key: string, limit: number): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("consume_api_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error) return false;
  const row = (Array.isArray(data) ? data[0] : data) as {
    allowed?: boolean;
  } | null;
  return row?.allowed === true;
}

/**
 * Has this exact address appeared in one of the chapter's recipient snapshots?
 *
 * Exact, not `ilike`. `_` and `%` are LIKE metacharacters, and `_` is a legal
 * local-part character that this form's validator accepts, so a typed
 * `m_mber@example.test` matched a stored `member@example.test` and the gate
 * reported a stranger's address as one of ours. That is the single thing it
 * exists to prevent.
 *
 * The comparison runs against the stored generated column
 * `normalized_recipient_email`, which is `lower(btrim(recipient_email))`. The
 * parsed input above is already trimmed and lowercased, so both sides normalize
 * the same way, and the lookup lands on
 * `csf_communication_recipient_snapshots_email_lookup_idx` instead of scanning.
 */
async function isKnownRecipient(
  organizationId: string,
  email: string,
): Promise<boolean> {
  const { data, error } = await createPluginAdminClient()
    .from("csf_communication_recipient_snapshots")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("normalized_recipient_email", email)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function requestCsfUnsubscribeAction(
  _previousState: CsfUnsubscribeRequestState,
  formData: FormData,
): Promise<CsfUnsubscribeRequestState> {
  const parsed = requestSchema.safeParse({
    organizationId: formData.get("organizationId"),
    topicKey: formData.get("topicKey"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { submitted: false, error: "Enter a valid email address." };
  }
  const { organizationId, topicKey, email } = parsed.data;

  try {
    const requestHeaders = await headers();
    const clientIp = (requestHeaders.get("x-forwarded-for") ?? "unknown")
      .split(",")[0]
      .trim();

    const [ipAllowed, addressAllowed] = await Promise.all([
      consumeBucket(
        `csf-unsubscribe:ip:${hashIdentifier(clientIp)}`,
        IP_LIMIT_PER_HOUR,
      ),
      consumeBucket(
        `csf-unsubscribe:email:${hashIdentifier(`${organizationId}:${email}`)}`,
        ADDRESS_LIMIT_PER_HOUR,
      ),
    ]);
    // A rate-limited request gets the SAME neutral response: the limiter
    // protects the mailbox and our sender, it does not report anything.
    if (!ipAllowed || !addressAllowed) return NEUTRAL_RESPONSE;

    if (!(await isKnownRecipient(organizationId, email))) {
      return NEUTRAL_RESPONSE;
    }

    const token = createCsfUnsubscribeToken({
      organizationId,
      topicKey,
      recipientEmail: email,
    });
    const confirmUrl = `${getInvitationBaseUrl()}/unsubscribe/csf/confirm?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: email,
      subject: "Confirm your unsubscribe from chapter announcements",
      react: React.createElement(CsfUnsubscribeConfirm, {
        chapterName: "DVHS CSF",
        confirmUrl,
        expiresInMinutes: 30,
      }),
      type: "transactional",
    });
  } catch {
    // Constant response even on internal failure; the visitor retries later.
  }

  return NEUTRAL_RESPONSE;
}
