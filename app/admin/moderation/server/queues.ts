"use server";
import { safeConsole } from "@/lib/safe-console";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { checkSuperAdmin } from "../../actions";
import { softRemoveContent } from "./enforcement";
import { notifyContentOwnerOfModeration } from "./notifications";
import { matchesReportStatusFilter } from "../report-status";
import { deriveSeverity } from "./shared";
import { summarizeModerationEvents } from "./moderation-statistics-summary";
import type { ModerationStats } from "../dashboard-types";
import {
  hasStatisticsResult,
  isMissingModerationStatisticsView,
  statisticsReadFailure,
  type StatisticsReadResult,
} from "./statistics-read-result";

export async function getFlaggedContent(
  status?: "pending" | "blocked" | "confirmed" | "dismissed",
) {
  "use server";
  const supabase = getAdminClient();

  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  let query = supabase
    .from("content_flags")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    safeConsole.error("Error fetching flagged content:", error);
    return { error: error.message };
  }

  const flags = data ?? [];

  const projectIds = flags
    .filter((flag) => flag.content_type === "project")
    .map((flag) => flag.content_id);
  const profileIds = flags
    .filter((flag) => flag.content_type === "profile")
    .map((flag) => flag.content_id);
  const organizationIds = flags
    .filter((flag) => flag.content_type === "organization")
    .map((flag) => flag.content_id);

  let projects: Array<{
    id: string;
    title: string | null;
    creator_id: string | null;
    organization_id: string | null;
  }> = [];
  let profiles: Array<{
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
    email?: string | null;
  }> = [];
  let organizations: Array<{
    id: string;
    name: string | null;
    username: string | null;
    created_by: string | null;
  }> = [];

  if (projectIds.length > 0) {
    const { data: projectData } = await supabase
      .from("projects")
      .select("id, title, creator_id, organization_id")
      .in("id", projectIds);
    projects = projectData || [];
  }

  if (profileIds.length > 0) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url, email")
      .in("id", profileIds);
    profiles = profileData || [];
  }

  if (organizationIds.length > 0) {
    const { data: orgData } = await supabase
      .from("organizations")
      .select("id, name, username, created_by")
      .in("id", organizationIds);
    organizations = orgData || [];
  }

  const creatorIds = new Set<string>();
  projects.forEach((project) => {
    if (project.creator_id) {
      creatorIds.add(project.creator_id);
    }
  });
  organizations.forEach((org) => {
    if (org.created_by) {
      creatorIds.add(org.created_by);
    }
  });

  const creatorProfiles = creatorIds.size
    ? await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url, email")
        .in("id", Array.from(creatorIds))
    : { data: [] };

  const creatorMap = new Map(
    (creatorProfiles.data || []).map((profile) => [profile.id, profile]),
  );
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const orgMap = new Map(organizations.map((org) => [org.id, org]));

  const enriched = flags.map((flag) => {
    const details = (flag.flag_details || {}) as Record<string, unknown>;
    let contentDetails: Record<string, unknown> | null = null;
    let creatorDetails: Record<string, unknown> | null = null;

    if (flag.content_type === "project") {
      const project = projectMap.get(flag.content_id);
      if (project) {
        contentDetails = project;
        if (project.creator_id) {
          creatorDetails = creatorMap.get(project.creator_id) || null;
        }
      }
    } else if (flag.content_type === "profile") {
      const profile = profileMap.get(flag.content_id);
      if (profile) {
        contentDetails = profile;
        creatorDetails = profile;
      }
    } else if (flag.content_type === "organization") {
      const org = orgMap.get(flag.content_id);
      if (org) {
        contentDetails = org;
        if (org.created_by) {
          creatorDetails = creatorMap.get(org.created_by) || null;
        }
      }
    }

    return {
      ...flag,
      severity: deriveSeverity(flag.confidence_score),
      reason:
        details.shortSummary ||
        details.verdict ||
        details.reasoning ||
        flag.flag_type ||
        "Flagged content",
      categories: flag.flagged_categories || null,
      content_details: contentDetails,
      creator_details: creatorDetails,
      profiles: creatorDetails,
    };
  });

  return { data: enriched };
}

/**
 * Get moderation logs for a specific user
 */
export async function getUserModerationLogs(_userId: string) {
  "use server";
  // moderation_logs table doesn't exist yet, return empty array
  return { data: [] };
}

/**
 * Update flagged content status
 */
export async function updateFlaggedContentStatus(
  id: string,
  status: "pending" | "blocked" | "confirmed" | "dismissed",
  reviewNotes?: string,
) {
  "use server";
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const {
    data: { user },
  } = await viewerSupabase.auth.getUser();

  const { data: existingFlags, error: checkError } = await supabase
    .from("content_flags")
    .select("id")
    .eq("id", id);

  if (checkError) {
    safeConsole.error("Error checking flagged content:", id, checkError);
    return { error: `Failed to check flagged content: ${checkError.message}` };
  }

  if (!existingFlags || existingFlags.length === 0) {
    safeConsole.error("Flagged content not found:", id);
    return { error: "Flagged content not found" };
  }

  const { data, error } = await supabase
    .from("content_flags")
    .update({
      status,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq("id", id)
    .select();

  if (error) {
    safeConsole.error("Error updating flagged content:", error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    safeConsole.error("No data returned after update for flagged content:", id);
    return { error: "Failed to update flagged content" };
  }

  const updatedFlag = data[0];

  if (
    status === "blocked" &&
    updatedFlag?.content_id &&
    updatedFlag?.content_type
  ) {
    await softRemoveContent(
      supabase,
      updatedFlag.content_type,
      updatedFlag.content_id,
      "block_content",
      user?.id || "system",
      reviewNotes ||
        `Flagged for ${updatedFlag.flag_type || "policy violation"}`,
    );

    await notifyContentOwnerOfModeration({
      supabase,
      contentType: updatedFlag.content_type,
      contentId: updatedFlag.content_id,
      action: "block_content",
      reason: reviewNotes || updatedFlag.flag_type || "Policy violation",
    });
  }

  if (
    updatedFlag?.content_id &&
    updatedFlag?.content_type &&
    updatedFlag?.flag_type
  ) {
    await notifyAdminsBatched({
      type: "flagged_content",
      contentId: updatedFlag.content_id,
      contentType: updatedFlag.content_type,
      flagType: updatedFlag.flag_type,
      confidenceScore: updatedFlag.confidence_score,
    });
  }

  return { data: updatedFlag };
}

/**
 * Get moderation statistics
 */
export async function getModerationStats(): Promise<
  StatisticsReadResult<ModerationStats>
> {
  "use server";
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  try {
    const supabase = getAdminClient();
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const viewResult = await supabase
      .from("content_moderation_events")
      .select(
        "source, status, priority, created_at, updated_at, resolution_notes, flag_source, confidence_score, ai_metadata",
        { count: "exact" },
      );
    const { data: moderationEvents, error: moderationEventsError } = viewResult;

    const missingViewError = isMissingModerationStatisticsView(
      moderationEventsError,
    );

    if (
      hasStatisticsResult(viewResult, "completeRows") &&
      Array.isArray(moderationEvents)
    ) {
      return summarizeModerationEvents(
        moderationEvents,
        sevenDaysAgo,
        oneDayAgo,
      );
    }

    if (!missingViewError) {
      return statisticsReadFailure("moderation", moderationEventsError);
    }

    const legacyResults = await Promise.all([
      supabase
        .from("content_flags")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true }),
      supabase.from("content_flags").select("status", { count: "exact" }),
      supabase.from("content_reports").select("status", { count: "exact" }),
      supabase
        .from("content_flags")
        .select("*", { count: "exact", head: true })
        .gte("confidence_score", 0.8),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true })
        .in("priority", ["high", "critical"]),
      supabase
        .from("content_flags")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo.toISOString()),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo.toISOString()),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true })
        .ilike("resolution_notes", "%Approved AI recommendation%"),
      supabase
        .from("content_flags")
        .select("*", { count: "exact", head: true })
        .eq("flag_source", "ai")
        .gte("created_at", oneDayAgo.toISOString()),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true })
        .not("ai_metadata", "is", null)
        .gte("updated_at", oneDayAgo.toISOString()),
      supabase
        .from("content_flags")
        .select("*", { count: "exact", head: true })
        .eq("flag_source", "ai"),
      supabase
        .from("content_reports")
        .select("*", { count: "exact", head: true })
        .not("ai_metadata", "is", null),
      supabase
        .from("content_flags")
        .select("created_at")
        .eq("flag_source", "ai")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("content_reports")
        .select("updated_at")
        .not("ai_metadata", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);
    const failedResult = legacyResults.find(
      (result, index) =>
        !hasStatisticsResult(
          result,
          [2, 3].includes(index)
            ? "completeRows"
            : [13, 14].includes(index)
              ? "rows"
              : "count",
        ),
    );
    if (failedResult) {
      return statisticsReadFailure("moderation", failedResult.error);
    }
    const [
      { count: totalFlagged },
      { count: totalReportsCount },
      { data: flagStatuses },
      { data: reportStatuses },
      { count: criticalFlagsCount },
      { count: criticalReportsCount },
      { count: recentFlagsCount },
      { count: recentReportsCount },
      { count: aiApprovedReportsCount },
      { count: aiFlagsLast24hCount },
      { count: aiReportsLast24hCount },
      { count: aiFlagsTotalCount },
      { count: aiReportsTotalCount },
      { data: latestAiFlagRows },
      { data: latestAiReportRows },
    ] = legacyResults;

    const flagStatusCounts = {
      pending: 0,
      blocked: 0,
      confirmed: 0,
      dismissed: 0,
    };

    for (const flag of flagStatuses || []) {
      const key = (flag.status || "pending") as keyof typeof flagStatusCounts;
      if (key in flagStatusCounts) {
        flagStatusCounts[key] += 1;
      }
    }

    const pendingReportsCount = (reportStatuses || []).filter((report) =>
      matchesReportStatusFilter(report.status, "pending"),
    ).length;

    const resolvedReportsCount = (reportStatuses || []).filter(
      (report) =>
        matchesReportStatusFilter(report.status, "resolved") ||
        matchesReportStatusFilter(report.status, "dismissed"),
    ).length;

    const resolvedFlagsCount =
      flagStatusCounts.confirmed +
      flagStatusCounts.blocked +
      flagStatusCounts.dismissed;

    const latestCandidates = [
      latestAiFlagRows?.[0]?.created_at,
      latestAiReportRows?.[0]?.updated_at,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()));

    const lastAutomationAt = latestCandidates.length
      ? latestCandidates
          .sort((a, b) => b.getTime() - a.getTime())[0]
          .toISOString()
      : null;

    // Combine stats from both tables
    const totalPending = flagStatusCounts.pending + pendingReportsCount;
    const totalCritical =
      (criticalFlagsCount || 0) + (criticalReportsCount || 0);
    const totalRecent = (recentFlagsCount || 0) + (recentReportsCount || 0);
    const totalResolved = resolvedFlagsCount + resolvedReportsCount;
    const automationLast24h =
      (aiFlagsLast24hCount || 0) + (aiReportsLast24hCount || 0);
    const automationTotal =
      (aiFlagsTotalCount || 0) + (aiReportsTotalCount || 0);

    return {
      data: {
        total: (totalFlagged || 0) + (totalReportsCount || 0),
        pending: totalPending,
        pendingFlags: flagStatusCounts.pending,
        pendingReports: pendingReportsCount,
        resolved: totalResolved,
        aiApproved: aiApprovedReportsCount || 0,
        automationLast24h,
        automationTotal,
        lastAutomationAt,
        blocked: flagStatusCounts.blocked,
        critical: totalCritical,
        recentWeek: totalRecent,
        monthlyActivity: 0,
      },
    };
  } catch (error) {
    return statisticsReadFailure("moderation", error);
  }
}

/**
 * Get repeat offenders (users with multiple violations)
 */
export async function getRepeatOffenders() {
  "use server";
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  // content_flags doesn't have user_id, so this function is not applicable yet
  return { data: [] };
}
