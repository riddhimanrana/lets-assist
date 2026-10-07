import { format } from "date-fns";

import { resolveSafeReportPath } from "@/lib/moderation/report-description";

import type { ContentReport, FlaggedContent } from "./dashboard-types";

export function formatSafeDate(value?: string | null, pattern = "PPp") {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return format(parsed, pattern);
}

export function formatConfidencePercent(value?: number) {
  if (value === undefined || value === null) return "—";
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`;
}

export function formatAiRecommendation(
  recommendedAction?: string | null,
  suggestedStatus?: string | null,
) {
  if (recommendedAction) {
    switch (recommendedAction) {
      case "remove_content":
        return "Remove content + notify owner";
      case "block_content":
        return "Block content + notify owner";
      case "warn_user":
        return "Warn owner";
      case "escalate_to_legal":
        return "Escalate to legal";
      case "none":
        return "Manual review";
      default:
        return recommendedAction.replace(/_/g, " ");
    }
  }

  if (suggestedStatus) {
    return suggestedStatus.replace(/_/g, " ");
  }

  return "Manual review";
}

export function formatFlagStatus(status?: string | null) {
  switch ((status || "pending").toLowerCase()) {
    case "blocked":
      return "Blocked";
    case "confirmed":
      return "Confirmed";
    case "dismissed":
      return "Dismissed";
    default:
      return "Pending review";
  }
}

export const getFlagContentUrl = (flag: FlaggedContent) => {
  if (!flag.content_id) return null;
  if (flag.content_type === "project") {
    return `/projects/${flag.content_id}`;
  }
  if (flag.content_type === "profile") {
    const profileSlug = flag.content_details?.username || flag.content_id;
    return `/profile/${profileSlug}`;
  }
  if (flag.content_type === "organization") {
    const orgSlug = flag.content_details?.username || flag.content_id;
    return `/organization/${orgSlug}`;
  }
  return null;
};

/**
 * Where the "view content" affordance points.
 *
 * The stored location is only used when it is a safe application-relative
 * path. Anything else — an absolute URL, a scheme-relative authority, a
 * legacy row written before locations were normalized — is discarded in
 * favor of the path derived from the report's own target type and
 * identifier, which are server-owned. A reporter must never be able to
 * choose where a moderator's click goes.
 */
export const getReportContentUrl = (
  report: ContentReport,
  storedLocation?: string | null,
) => {
  const safeLocation = resolveSafeReportPath(storedLocation);
  if (safeLocation) return safeLocation;

  if (report.content_type === "project" && report.content_id) {
    return `/projects/${report.content_id}`;
  }

  if (report.content_type === "profile" && report.content_id) {
    const profileSlug = report.creator_details?.username || report.content_id;
    return `/profile/${profileSlug}`;
  }

  if (report.content_type === "organization" && report.content_id) {
    const orgSlug = report.content_details?.username || report.content_id;
    return `/organization/${orgSlug}`;
  }

  return null;
};
