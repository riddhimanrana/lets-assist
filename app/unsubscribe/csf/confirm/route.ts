import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { recordCsfBroadcastPreferenceDecision } from "@/services/csf-communications-campaign";
import { verifyCsfUnsubscribeToken } from "@/services/csf-unsubscribe-token";

/**
 * Step two of the verify-the-address unsubscribe loop: the bearer of a valid
 * token proved control of the mailbox, so the decision is recorded as a
 * RECIPIENT decision bound to exactly that address. The token itself names the
 * organization, topic, and address; nothing else in the request is trusted.
 *
 * `decision=resubscribe` reuses the same token within its 30-minute window so
 * an accidental opt-out is reversible from the confirmation page without a
 * second email round trip.
 */

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function confirmationPage(message: string, resubscribeUrl?: string) {
  const resubscribeBlock = resubscribeUrl
    ? `<p style="margin-top:16px"><a href="${escapeHtml(resubscribeUrl)}" style="color:#16a34a">Changed your mind? Resubscribe</a></p>`
    : "";
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Announcement emails</title></head>` +
      `<body style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;display:flex;justify-content:center;padding:64px 16px"><main style="max-width:28rem">` +
      `<h1 style="font-size:1.4rem;margin:0 0 12px">Announcement emails</h1><p style="line-height:1.6;color:#374151">${escapeHtml(message)}</p>${resubscribeBlock}` +
      `</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const decision =
    request.nextUrl.searchParams.get("decision") === "resubscribe"
      ? ("resubscribe" as const)
      : ("opt_out" as const);

  const payload = verifyCsfUnsubscribeToken(token);
  if (!payload) {
    return confirmationPage(
      "This confirmation link is invalid or has expired. Request a new one from the unsubscribe page in any announcement email.",
    );
  }

  const plugin = createPluginAdminClient();
  try {
    await recordCsfBroadcastPreferenceDecision(
      {
        rpc: async (fn, args) => {
          const { data, error } = await plugin.rpc(fn, args);
          return {
            data,
            error: error
              ? {
                  message: error.message,
                  ...(typeof error.code === "string"
                    ? { code: error.code }
                    : {}),
                }
              : null,
          };
        },
      },
      {
        organizationId: payload.organizationId,
        topicKey: payload.topicKey,
        recipientEmail: payload.recipientEmail,
        decision,
        actorKind: "recipient",
        verifiedRecipientEmailHash: createHash("sha256")
          .update(payload.recipientEmail)
          .digest("hex"),
        reason:
          decision === "opt_out"
            ? "Recipient confirmed unsubscribe by email token."
            : "Recipient resubscribed from the confirmation page.",
      },
    );
  } catch {
    return confirmationPage(
      "Something went wrong recording your choice. The link is still valid for 30 minutes from when it was sent — try it again shortly.",
    );
  }

  if (decision === "resubscribe") {
    return confirmationPage(
      "You're resubscribed. Chapter announcements will reach this address again.",
    );
  }

  const resubscribeParams = new URLSearchParams({
    token: token ?? "",
    decision: "resubscribe",
  });
  const resubscribeUrl = `/unsubscribe/csf/confirm?${resubscribeParams.toString()}`;
  return confirmationPage(
    "Done — this address will no longer receive chapter announcement emails. Required emails about your own account or membership are unaffected.",
    resubscribeUrl,
  );
}
