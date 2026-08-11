import { NextRequest, NextResponse } from "next/server";

import { verifyProjectFeedbackToken } from "@/services/project-feedback-token";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Unsubscribe from post-project follow-up emails (styled on
 * app/unsubscribe/csf/confirm/route.ts). Both GET and POST are handled
 * because RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) requires
 * POST, while humans arrive by GET from the email footer.
 *
 * Anonymous subjects get anonymous_signups.email_opt_out_at (there is no
 * account to hold a preference); user subjects get
 * notification_settings.project_updates = false — the same switch that
 * gates every other project update email. ?decision=resubscribe reverses
 * either.
 */

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
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function htmlPage(message: string, resubscribeUrl?: string) {
  const resubscribeBlock = resubscribeUrl
    ? `<p style="margin-top:16px"><a href="${escapeHtml(resubscribeUrl)}" style="color:#16a34a">Changed your mind? Resubscribe</a></p>`
    : "";
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Project feedback emails</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px">` +
      `<h1 style="font-size:1.4rem;margin:0 0 12px">Project feedback emails</h1><p style="line-height:1.6;color:#374151">${escapeHtml(message)}</p>${resubscribeBlock}` +
      `</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handle(request: NextRequest, requestId: string) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const resubscribe = url.searchParams.get("decision") === "resubscribe";

  const payload = verifyProjectFeedbackToken(token);
  if (!payload || payload.requestId !== requestId) {
    return htmlPage(
      "This link is invalid or has expired. Feedback links last 30 days.",
    );
  }

  const admin = getAdminClient();
  const { data: feedbackRequest } = await admin
    .from("project_feedback_requests")
    .select("id, user_id, anonymous_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!feedbackRequest) {
    return htmlPage(
      "This link is invalid or has expired. Feedback links last 30 days.",
    );
  }

  const subjectMatches =
    payload.subject.kind === "user"
      ? feedbackRequest.user_id === payload.subject.userId
      : feedbackRequest.anonymous_id === payload.subject.anonymousSignupId;
  if (!subjectMatches) {
    return htmlPage(
      "This link is invalid or has expired. Feedback links last 30 days.",
    );
  }

  const resubscribeUrl = `${url.origin}${url.pathname}?token=${encodeURIComponent(token!)}&decision=resubscribe`;

  if (payload.subject.kind === "anonymous") {
    const { error } = await admin
      .from("anonymous_signups")
      .update({
        email_opt_out_at: resubscribe ? null : new Date().toISOString(),
      })
      .eq("id", payload.subject.anonymousSignupId);
    if (error) {
      return htmlPage("Something went wrong. Please try the link again.");
    }
  } else {
    const { error } = await admin.from("notification_settings").upsert(
      {
        user_id: payload.subject.userId,
        project_updates: resubscribe,
      },
      { onConflict: "user_id" },
    );
    if (error) {
      return htmlPage("Something went wrong. Please try the link again.");
    }
  }

  return resubscribe
    ? htmlPage("You're resubscribed to project update emails.")
    : htmlPage(
        payload.subject.kind === "anonymous"
          ? "Done — this address won't receive project follow-up emails anymore. Signup confirmations for events you register for are unaffected."
          : "Done — project update emails (including these follow-ups) are turned off for your account. You can change this anytime in your notification settings.",
        resubscribeUrl,
      );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  return handle(request, requestId);
}

// RFC 8058 one-click unsubscribe.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  return handle(request, requestId);
}
