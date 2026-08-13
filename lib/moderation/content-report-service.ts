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
  buildContentReportFingerprint,
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

/** Stored-report quota: how many reports one reporter may actually file. */
export const CONTENT_REPORT_WINDOW_SECONDS = 3_600;
export const CONTENT_REPORT_USER_LIMIT = 10;
export const CONTENT_REPORT_IP_LIMIT = 30;

/**
 * Attempt quota: how much work one reporter may *ask for*.
 *
 * Every path below — a forged target, a malformed location, a replay, an
 * exhausted stored-report quota — used to be free. Each of them still costs an
 * authenticated session lookup, an RLS-scoped select, and usually a database
 * round trip, so an authenticated caller could generate unbounded load without
 * ever storing a row. This ceiling is charged first, before the target is
 * resolved, and is deliberately much higher than the stored-report quota so a
 * legitimate reporter who mistypes, retries, or reports several things in a
 * sitting never meets it.
 */
export const CONTENT_REPORT_ATTEMPT_WINDOW_SECONDS = 3_600;
export const CONTENT_REPORT_USER_ATTEMPT_LIMIT = 60;
export const CONTENT_REPORT_IP_ATTEMPT_LIMIT = 200;

/**
 * How long an identical resubmission keeps replaying the original report.
 *
 * Long enough to absorb a network retry, a double-click, or a client that
 * resends after a timeout; short enough that the mechanism cannot silently
 * swallow a genuine second report of the same content after moderators have
 * already resolved or dismissed the first. The window is measured by the
 * database's own clock, never by anything the client sends.
 */
export const CONTENT_REPORT_REPLAY_WINDOW_SECONDS = 900;

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
  outcome: string | null;
  report_id: string | null;
  reset_at: string | null;
};

type AttemptRow = {
  allowed: boolean;
  reset_at: string | null;
};

function buildQuotaKey(
  namespace: string,
  scope: string,
  identifier: string,
): string {
  return `moderation:${namespace}:${scope}:${hashRateLimitIdentifier(identifier)}`;
}

/**
 * The reporter's IP, or nothing.
 *
 * `getRequestIp` returns the literal string `unknown` when no forwarding
 * header is present. Hashing that sentinel would build one shared bucket that
 * every header-less caller competes for, so a single script could exhaust the
 * IP dimension for all of them. When there is no address to attribute, the IP
 * dimension is simply omitted and the per-user ceiling stands alone.
 */
function resolveReporterIp(requestHeaders: Headers): string | undefined {
  const candidate = getRequestIp(requestHeaders);
  return candidate && candidate !== "unknown" ? candidate : undefined;
}

/**
 * Build the aligned bucket-key and bucket-limit arrays for one decision.
 *
 * The two arrays are positional, so they are always constructed together.
 */
function buildQuotaBuckets(input: {
  namespace: string;
  reporterId: string;
  reporterIp: string | undefined;
  userLimit: number;
  ipLimit: number;
}): { keys: string[]; limits: number[] } {
  const keys = [buildQuotaKey(input.namespace, "user", input.reporterId)];
  const limits = [input.userLimit];

  if (input.reporterIp) {
    keys.push(buildQuotaKey(input.namespace, "ip", input.reporterIp));
    limits.push(input.ipLimit);
  }

  return { keys, limits };
}

function retryAfterSeconds(
  resetAt: string | null,
  now: Date,
  windowSeconds: number,
): number {
  const reset = resetAt ? new Date(resetAt).getTime() : Number.NaN;
  if (!Number.isFinite(reset)) return windowSeconds;
  return Math.min(
    Math.max(Math.ceil((reset - now.getTime()) / 1_000), 1),
    windowSeconds,
  );
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
 * Charge the attempt ceiling before any target work happens.
 *
 * The decision is atomic across every bucket in one service-role-only
 * transaction: a rejected IP bucket never consumes the user bucket, and a
 * transport or database failure fails closed rather than admitting the work.
 */
async function consumeAttemptQuota(input: {
  reporterId: string;
  reporterIp: string | undefined;
  now: Date;
}): Promise<"allowed" | "unavailable" | { retryAfter: number }> {
  const { keys, limits } = buildQuotaBuckets({
    namespace: "content-report-attempt",
    reporterId: input.reporterId,
    reporterIp: input.reporterIp,
    userLimit: CONTENT_REPORT_USER_ATTEMPT_LIMIT,
    ipLimit: CONTENT_REPORT_IP_ATTEMPT_LIMIT,
  });

  const { data, error } = await getAdminClient().rpc(
    "consume_content_report_attempt",
    {
      p_rate_limit_keys: keys,
      p_rate_limit_limits: limits,
      p_rate_limit_window_seconds: CONTENT_REPORT_ATTEMPT_WINDOW_SECONDS,
    },
  );

  if (error) {
    logError(
      "Content report attempt metering failed",
      new Error("report_attempt_metering_failed"),
    );
    return "unavailable";
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    AttemptRow | null | undefined;

  if (!row || typeof row.allowed !== "boolean") {
    logError(
      "Content report attempt metering returned an unusable row",
      new Error("report_attempt_contract_failed"),
    );
    return "unavailable";
  }

  if (row.allowed) return "allowed";
  return {
    retryAfter: retryAfterSeconds(
      row.reset_at,
      input.now,
      CONTENT_REPORT_ATTEMPT_WINDOW_SECONDS,
    ),
  };
}

/**
 * Confirm the reported resource exists *for this reporter*.
 *
 * The lookup runs through the reporter's own RLS-scoped session, so it can
 * never confirm a row the reporter could not already read directly through the
 * Data API: it adds no enumeration oracle, and it stops an arbitrary UUID from
 * becoming durable moderation evidence. The transaction repeats an
 * existence-only check under its own lock, so authorization and existence stay
 * on the two sides that can actually enforce them.
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
  const now = input.now ?? new Date();
  const reporterIp = resolveReporterIp(requestHeaders);

  const attempt = await consumeAttemptQuota({ reporterId, reporterIp, now });
  if (attempt === "unavailable") return { status: "unavailable" };
  if (attempt !== "allowed") {
    return { status: "rate_limited", retryAfterSeconds: attempt.retryAfter };
  }

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

  const fingerprint = buildContentReportFingerprint({
    reporterId,
    submission,
    normalizedUrl,
  });

  const reportQuota = buildQuotaBuckets({
    namespace: "content-report",
    reporterId,
    reporterIp,
    userLimit: CONTENT_REPORT_USER_LIMIT,
    ipLimit: CONTENT_REPORT_IP_LIMIT,
  });

  const { data, error } = await getAdminClient().rpc("submit_content_report", {
    p_request_fingerprint: fingerprint,
    p_reporter_id: reporterId,
    p_content_type: submission.contentType,
    p_content_id: submission.contentId,
    p_reason: submission.reason,
    p_description: buildReportDescription(submission, normalizedUrl),
    p_replay_window_seconds: CONTENT_REPORT_REPLAY_WINDOW_SECONDS,
    p_rate_limit_keys: reportQuota.keys,
    p_rate_limit_limits: reportQuota.limits,
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

  if (row?.outcome === "rate_limited") {
    return {
      status: "rate_limited",
      retryAfterSeconds: retryAfterSeconds(
        row.reset_at,
        now,
        CONTENT_REPORT_WINDOW_SECONDS,
      ),
    };
  }

  // The transaction re-checks target existence under its own lock. It reports
  // that generically, with no indication of which relation or identifier was
  // involved, and the route maps it to the same `400` as any other bad input.
  if (row?.outcome === "invalid_target") return { status: "invalid_input" };

  if (
    (row?.outcome !== "created" && row?.outcome !== "replayed") ||
    !row.report_id
  ) {
    logError(
      "Content report transaction returned an unusable row",
      new Error("report_transaction_contract_failed"),
      { content_type: submission.contentType },
    );
    return { status: "unavailable" };
  }

  return { status: row.outcome, reportId: row.report_id };
}
