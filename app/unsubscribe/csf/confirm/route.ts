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
 *
 * GET NEVER MUTATES CONSENT, AND THAT IS NOT A STYLE PREFERENCE.
 *
 * This URL is delivered by email, and inbound mail security scanners --
 * Microsoft Defender Safe Links detonation, Proofpoint URL Defense, Barracuda
 * and friends -- fetch the links they find before the recipient ever sees the
 * message. A GET that wrote the opt-out therefore recorded a decision the
 * recipient never made, and the append-only decision history attributed it to
 * them as `recipient`.
 *
 * That was reachable by a third party, not just by accident: step one accepts
 * any address from an anonymous visitor and mails the token to it whenever the
 * address appears in a chapter's recipient snapshot. Someone who knew a
 * member's address could get the confirmation email delivered to that member's
 * mailbox and let the mailbox's own scanner do the unsubscribing.
 *
 * So GET renders a page whose only action is a POST, and the mutation lives in
 * POST. The unguessable signed token remains the CSRF defense -- a cross-site
 * form post cannot supply one -- and RFC 8058 wants POST here regardless.
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

function page(bodyHtml: string) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Announcement emails</title></head>` +
      `<body style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;display:flex;justify-content:center;padding:64px 16px"><main style="max-width:28rem">` +
      `<h1 style="font-size:1.4rem;margin:0 0 12px">Announcement emails</h1>${bodyHtml}` +
      `</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function messagePage(message: string) {
  return page(
    `<p style="line-height:1.6;color:#374151">${escapeHtml(message)}</p>`,
  );
}

/**
 * The confirmation page: a description and one button that posts the decision.
 *
 * The token travels in a hidden field rather than the action URL so it is not
 * re-echoed into a referrer or a browser history entry on submit.
 */
function actionPage(
  message: string,
  token: string,
  decision: "opt_out" | "resubscribe",
  submitLabel: string,
) {
  return page(
    `<p style="line-height:1.6;color:#374151">${escapeHtml(message)}</p>` +
      `<form method="post" action="/unsubscribe/csf/confirm" style="margin-top:20px">` +
      `<input type="hidden" name="token" value="${escapeHtml(token)}">` +
      `<input type="hidden" name="decision" value="${escapeHtml(decision)}">` +
      `<button type="submit" style="background:#16a34a;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:1rem;cursor:pointer">${escapeHtml(submitLabel)}</button>` +
      `</form>`,
  );
}

function readDecision(value: string | null): "opt_out" | "resubscribe" {
  return value === "resubscribe" ? "resubscribe" : "opt_out";
}

/**
 * Render the confirmation. NOTHING IS WRITTEN HERE.
 *
 * The token is still verified, because telling somebody their expired link
 * expired is more useful than showing them a button that will fail.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const decision = readDecision(request.nextUrl.searchParams.get("decision"));

  const payload = verifyCsfUnsubscribeToken(token);
  if (!payload || !token) {
    return messagePage(
      "This confirmation link is invalid or has expired. Request a new one from the unsubscribe page in any announcement email.",
    );
  }

  return decision === "resubscribe"
    ? actionPage(
        "Confirm that this address should receive chapter announcement emails again.",
        token,
        "resubscribe",
        "Resubscribe",
      )
    : actionPage(
        "Confirm that this address should stop receiving chapter announcement emails. Required emails about your own account or membership are unaffected.",
        token,
        "opt_out",
        "Unsubscribe",
      );
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const formToken = form?.get("token");
  const token =
    typeof formToken === "string"
      ? formToken
      : request.nextUrl.searchParams.get("token");
  const formDecision = form?.get("decision");
  const decision = readDecision(
    typeof formDecision === "string"
      ? formDecision
      : request.nextUrl.searchParams.get("decision"),
  );

  const payload = verifyCsfUnsubscribeToken(token);
  if (!payload || !token) {
    return messagePage(
      "This confirmation link is invalid or has expired. Request a new one from the unsubscribe page in any announcement email.",
    );
  }

  const plugin = createPluginAdminClient();
  let result;
  try {
    result = await recordCsfBroadcastPreferenceDecision(
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
    return messagePage(
      "Something went wrong recording your choice. The link is still valid for 30 minutes from when it was sent — try it again shortly.",
    );
  }

  // REPORT WHAT THE LEDGER STORED, NOT WHAT WAS ASKED FOR.
  //
  // The RPC can succeed and still decline to apply the decision: if a staff
  // resubscribe commits with a later decision timestamp while this transaction
  // is in flight, it returns `applied: false` with the standing state. Echoing
  // the requested decision back told the recipient "you will no longer receive
  // chapter announcements" while the ledger had them subscribed.
  if (result.subscriptionState === "subscribed") {
    return decision === "resubscribe"
      ? messagePage(
          "You're resubscribed. Chapter announcements will reach this address again.",
        )
      : actionPage(
          "This address is currently set to receive chapter announcements — a more recent change to these settings took precedence over the request. Try again if you still want to unsubscribe.",
          token,
          "opt_out",
          "Unsubscribe",
        );
  }

  return decision === "opt_out"
    ? actionPage(
        "Done — this address will no longer receive chapter announcement emails. Required emails about your own account or membership are unaffected.",
        token,
        "resubscribe",
        "Changed your mind? Resubscribe",
      )
    : actionPage(
        "This address is still unsubscribed from chapter announcements — a more recent change to these settings took precedence over the request.",
        token,
        "resubscribe",
        "Resubscribe",
      );
}
