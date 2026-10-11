import "server-only";

import { matchesReportStatusFilter } from "../report-status";
import type { ModerationStats } from "../dashboard-types";

type ModerationEvent = {
  source: string | null;
  status: string | null;
  priority: string | null;
  created_at: string | null;
  updated_at: string | null;
  resolution_notes: string | null;
  flag_source: string | null;
  confidence_score: number | null;
  ai_metadata: unknown;
};

/** Summarize an already validated view read; this helper performs no queries. */
export function summarizeModerationEvents(
  moderationEvents: ModerationEvent[],
  sevenDaysAgo: Date,
  oneDayAgo: Date,
): { data: ModerationStats } {
  const isRecentWeek = (value: string | null | undefined) => {
    if (!value) return false;
    const ts = new Date(value);
    return !Number.isNaN(ts.getTime()) && ts >= sevenDaysAgo;
  };

  const isRecentDay = (value: string | null | undefined) => {
    if (!value) return false;
    const ts = new Date(value);
    return !Number.isNaN(ts.getTime()) && ts >= oneDayAgo;
  };

  const pendingFlags = moderationEvents.filter(
    (event) =>
      event.source === "flag" && (event.status || "pending") === "pending",
  ).length;

  const pendingReports = moderationEvents.filter(
    (event) =>
      event.source === "report" &&
      matchesReportStatusFilter(event.status, "pending"),
  ).length;

  const resolvedFlags = moderationEvents.filter(
    (event) =>
      event.source === "flag" &&
      ["blocked", "confirmed", "dismissed"].includes(event.status || ""),
  ).length;

  const resolvedReports = moderationEvents.filter(
    (event) =>
      event.source === "report" &&
      (matchesReportStatusFilter(event.status, "resolved") ||
        matchesReportStatusFilter(event.status, "dismissed")),
  ).length;

  const blockedFlags = moderationEvents.filter(
    (event) => event.source === "flag" && event.status === "blocked",
  ).length;

  const criticalFlags = moderationEvents.filter(
    (event) =>
      event.source === "flag" &&
      typeof event.confidence_score === "number" &&
      event.confidence_score >= 0.8,
  ).length;

  const criticalReports = moderationEvents.filter(
    (event) =>
      event.source === "report" &&
      ["high", "critical"].includes((event.priority || "").toLowerCase()),
  ).length;

  const recentFlags = moderationEvents.filter(
    (event) => event.source === "flag" && isRecentWeek(event.created_at),
  ).length;

  const recentReports = moderationEvents.filter(
    (event) => event.source === "report" && isRecentWeek(event.created_at),
  ).length;

  const aiApprovedReports = moderationEvents.filter(
    (event) =>
      event.source === "report" &&
      typeof event.resolution_notes === "string" &&
      event.resolution_notes
        .toLowerCase()
        .includes("approved ai recommendation"),
  ).length;

  const aiFlagsTotal = moderationEvents.filter(
    (event) => event.source === "flag" && event.flag_source === "ai",
  ).length;

  const aiReportsTotal = moderationEvents.filter(
    (event) => event.source === "report" && event.ai_metadata !== null,
  ).length;

  const aiFlagsLast24h = moderationEvents.filter(
    (event) =>
      event.source === "flag" &&
      event.flag_source === "ai" &&
      isRecentDay(event.created_at),
  ).length;

  const aiReportsLast24h = moderationEvents.filter(
    (event) =>
      event.source === "report" &&
      event.ai_metadata !== null &&
      isRecentDay(event.updated_at),
  ).length;

  const latestAiFlag = moderationEvents
    .filter((event) => event.source === "flag" && event.flag_source === "ai")
    .map((event) => event.created_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const latestAiReport = moderationEvents
    .filter((event) => event.source === "report" && event.ai_metadata !== null)
    .map((event) => event.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const latestCandidates = [latestAiFlag, latestAiReport].filter(
    (value): value is Date => Boolean(value),
  );

  const lastAutomationAt = latestCandidates.length
    ? latestCandidates
        .sort((a, b) => b.getTime() - a.getTime())[0]
        .toISOString()
    : null;

  return {
    data: {
      total: moderationEvents.length,
      pending: pendingFlags + pendingReports,
      pendingFlags,
      pendingReports,
      resolved: resolvedFlags + resolvedReports,
      aiApproved: aiApprovedReports,
      automationLast24h: aiFlagsLast24h + aiReportsLast24h,
      automationTotal: aiFlagsTotal + aiReportsTotal,
      lastAutomationAt,
      blocked: blockedFlags,
      critical: criticalFlags + criticalReports,
      recentWeek: recentFlags + recentReports,
      monthlyActivity: 0,
    },
  };
}
