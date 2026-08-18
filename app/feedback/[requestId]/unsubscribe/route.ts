import { NextRequest, NextResponse } from "next/server";

import { verifyProjectFeedbackToken } from "@/services/project-feedback-token";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Unsubscribe from post-project follow-up emails (styled on
 * app/unsubscribe/csf/confirm/route.ts). Both GET and POST are handled
 * because RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) requires
 * POST. Humans who arrive by GET from the email footer must explicitly
 * confirm before anything changes: mailbox security scanners prefetch links.
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

function htmlPage(
  message: string,
  action?: {
    requestId: string;
    token: string;
    decision: "unsubscribe" | "resubscribe";
    label: string;
  },
) {
  const actionBlock = action
    ? `<form method="post" action="/feedback/${escapeHtml(action.requestId)}/unsubscribe" style="margin-top:16px">` +
      `<input type="hidden" name="token" value="${escapeHtml(action.token)}">` +
      `<input type="hidden" name="decision" value="${escapeHtml(action.decision)}">` +
      `<button type="submit" style="background:#16a34a;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:1rem;cursor:pointer">${escapeHtml(action.label)}</button></form>`
    : "";
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Project feedback emails</title></head>` +
      `<body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px">` +
      `<h1 style="font-size:1.4rem;margin:0 0 12px">Project feedback emails</h1><p style="line-height:1.6;color:#374151">${escapeHtml(message)}</p>${actionBlock}` +
      `</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    },
  );
}

function readDecision(value: FormDataEntryValue | string | null) {
  return value === "resubscribe" ? "resubscribe" : "unsubscribe";
}

async function applyDecision(
  requestId: string,
  token: string | null,
  decision: "unsubscribe" | "resubscribe",
) {
  const resubscribe = decision === "resubscribe";

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
        {
          requestId,
          token: token!,
          decision: "resubscribe",
          label: "Changed your mind? Resubscribe",
        },
      );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
  const token = request.nextUrl.searchParams.get("token");
  const decision = readDecision(request.nextUrl.searchParams.get("decision"));
  const payload = verifyProjectFeedbackToken(token);
  if (!payload || payload.requestId !== requestId || !token) {
    return htmlPage(
      "This link is invalid or has expired. Feedback links last 30 days.",
    );
  }

  return decision === "resubscribe"
    ? htmlPage(
        "Confirm that you want to receive project update emails again.",
        { requestId, token, decision, label: "Resubscribe" },
      )
    : htmlPage(
        "Confirm that you want to stop receiving project follow-up emails.",
        { requestId, token, decision, label: "Unsubscribe" },
      );
}

// RFC 8058 one-click unsubscribe.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await context.params;
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
  return applyDecision(requestId, token, decision);
}
