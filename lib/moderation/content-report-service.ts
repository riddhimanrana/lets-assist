import "server-only";

import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { hashRateLimitIdentifier } from "@/lib/ai/rate-limit";
import { logError } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAuthRequestOrigin,
  resolveConfiguredSiteOrigin,
} from "@/app/signup/request-origin";
import {
  buildContentReportRequestKey,
  buildReportDescription,
  CONTENT_REPORT_TARGET_RELATIONS,
  ContentReportBodyError,
  isResolvableContentType,
  normalizeReportedContentUrl,
  type ContentReportSubmission,
} from "@/lib/moderation/content-report-submission";

/**
 * Domain service for content reports.
 *
 * The route only maps HTTP to this contract. Everything consequential — the
 * trusted origin, whether the reported resource exists inside the reporter's
 * own visibility, the combined quota decision, idempotency, and the actual
 * write — happens here and in the single reviewed database transaction it
 * calls.
 */

export const CONTENT_REPORT_WINDOW_SECONDS = 3_600;
export const CONTENT_REPORT_USER_LIMIT = 10;
export const CONTENT_REPORT_IP_LIMIT = 30;

export type ContentReportResult =
  | { status: "created"; reportId: string }
  | { status: "replayed"; reportId: string }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "invalid_input" }
  | { status: "unavailable" };

type SubmitContentReportInput = {
  reporterId: string;
  submission: ContentReportSubmission;
  requestHeaders: Headers;
  now?: Date;
};

type SubmitContentReportRow = {
  report_id: string | null;
  replayed: boolean;
  allowed: boolean;
  reset_at: string | null;
};

function buildQuotaKey(scope: string, identifier: string): string {
  return `moderation:content-report:${scope}:${hashRateLimitIdentifier(identifier)}`;
}

/**
 * The origin this deployment is allowed to consider "our own content".
 *
 * `resolveConfiguredSiteOrigin` is configuration-only, and
 * `resolveAuthRequestOrigin` narrows the request's influence to the one case
 * the repository already accepts: a loopback development server answering on
 * the same loopback port. A hosted deployment ignores `Host` entirely.
 */
function resolveTrustedOrigin(requestHeaders: Headers): string {
  return resolveAuthRequestOrigin({
    configuredOrigin: resolveConfiguredSiteOrigin(),
    requestHost: requestHeaders.get("host"),
  });
}

/**
 * Confirm the reported resource exists *for this reporter*.
 *
 * The lookup runs through the reporter's own RLS-scoped session, so it can
 * never confirm a row the reporter could not already read directly through the
 * Data API: it adds no enumeration oracle, and it stops an arbitrary UUID from
 * becoming durable moderation evidence. Content types the moderation queue
 * cannot act on are refused outright.
 */
async function reporterCanSeeTarget(
  submission: ContentReportSubmission,
): Promise<"visible" | "missing" | "unavailable"> {
  if (!isResolvableContentType(submission.contentType)) return "missing";

  const relation = CONTENT_REPORT_TARGET_RELATIONS[submission.contentType];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(relation)
    .select("id")
    .eq("id", submission.contentId)
    .maybeSingle();

  if (error) return "unavailable";
  return data ? "visible" : "missing";
}

export async function submitContentReport(
  input: SubmitContentReportInput,
): Promise<ContentReportResult> {
  const { reporterId, submission, requestHeaders } = input;

  let normalizedUrl: string | undefined;
  try {
    normalizedUrl = normalizeReportedContentUrl(
      submission.url,
      resolveTrustedOrigin(requestHeaders),
    );
  } catch (originError) {
    if (originError instanceof ContentReportBodyError) {
      return { status: "invalid_input" };
    }
    // A deployment with no valid configured origin cannot decide what is
    // same-origin, so it refuses rather than guessing.
    logError(
      "Content report origin resolution failed",
      new Error("report_origin_unresolved"),
    );
    return { status: "unavailable" };
  }

  const visibility = await reporterCanSeeTarget(submission);
  if (visibility === "unavailable") {
    logError(
      "Content report target lookup failed",
      new Error("report_target_lookup_failed"),
      { content_type: submission.contentType },
    );
    return { status: "unavailable" };
  }
  if (visibility === "missing") return { status: "invalid_input" };

  const requestKey = buildContentReportRequestKey({
    reporterId,
    submission,
    normalizedUrl,
  });

  const { data, error } = await getAdminClient().rpc("submit_content_report", {
    p_request_key: requestKey,
    p_reporter_id: reporterId,
    p_content_type: submission.contentType,
    p_content_id: submission.contentId,
    p_reason: submission.reason,
    p_description: buildReportDescription(submission, normalizedUrl),
    p_rate_limit_keys: [
      buildQuotaKey("user", reporterId),
      buildQuotaKey("ip", getRequestIp(requestHeaders)),
    ],
    p_rate_limit_limits: [CONTENT_REPORT_USER_LIMIT, CONTENT_REPORT_IP_LIMIT],
    p_rate_limit_window_seconds: CONTENT_REPORT_WINDOW_SECONDS,
  });

  if (error) {
    logError(
      "Content report transaction failed",
      new Error("report_transaction_failed"),
      { content_type: submission.contentType, reason: submission.reason },
    );
    return { status: "unavailable" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    SubmitContentReportRow | null | undefined;

  if (!row || typeof row.allowed !== "boolean") {
    logError(
      "Content report transaction returned an unusable row",
      new Error("report_transaction_contract_failed"),
      { content_type: submission.contentType },
    );
    return { status: "unavailable" };
  }

  if (!row.allowed) {
    const resetAt = row.reset_at
      ? new Date(row.reset_at).getTime()
      : Number.NaN;
    const now = (input.now ?? new Date()).getTime();
    const retryAfterSeconds = Number.isFinite(resetAt)
      ? Math.min(
          Math.max(Math.ceil((resetAt - now) / 1_000), 1),
          CONTENT_REPORT_WINDOW_SECONDS,
        )
      : CONTENT_REPORT_WINDOW_SECONDS;
    return { status: "rate_limited", retryAfterSeconds };
  }

  if (!row.report_id) {
    logError(
      "Content report transaction allowed the write without an identifier",
      new Error("report_transaction_contract_failed"),
      { content_type: submission.contentType },
    );
    return { status: "unavailable" };
  }

  return {
    status: row.replayed ? "replayed" : "created",
    reportId: row.report_id,
  };
}
