"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { checkSuperAdmin } from "../../actions";
import { softRemoveContent } from "./enforcement";
import { notifyContentOwnerOfModeration } from "./notifications";
import { matchesReportStatusFilter } from "../report-status";
import { deriveSeverity } from "./shared";

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
    console.error("Error fetching flagged content:", error);
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
    console.error("Error checking flagged content:", id, checkError);
    return { error: `Failed to check flagged content: ${checkError.message}` };
  }

  if (!existingFlags || existingFlags.length === 0) {
    console.error("Flagged content not found:", id);
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
    console.error("Error updating flagged content:", error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    console.error("No data returned after update for flagged content:", id);
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
export async function getModerationStats() {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const oneDayAgo = new Date(now);
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const { data: moderationEvents, error: moderationEventsError } =
    await supabase
      .from("content_moderation_events")
      .select(
        "source, status, priority, created_at, updated_at, resolution_notes, flag_source, confidence_score, ai_metadata",
      );

  const missingViewError =
    moderationEventsError?.code === "42P01" ||
    moderationEventsError?.code === "42703" ||
    (typeof moderationEventsError?.message === "string" &&
      moderationEventsError.message.includes("does not exist"));

  if (!moderationEventsError && moderationEvents) {
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
      .filter(
        (event) => event.source === "report" && event.ai_metadata !== null,
      )
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

  if (moderationEventsError && !missingViewError) {
    console.warn(
      "Falling back to legacy moderation stats queries due to view error:",
      moderationEventsError,
    );
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
  ] = await Promise.all([
    supabase.from("content_flags").select("*", { count: "exact", head: true }),
    supabase
      .from("content_reports")
      .select("*", { count: "exact", head: true }),
    supabase.from("content_flags").select("status"),
    supabase.from("content_reports").select("status"),
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
  const totalCritical = (criticalFlagsCount || 0) + (criticalReportsCount || 0);
  const totalRecent = (recentFlagsCount || 0) + (recentReportsCount || 0);
  const totalResolved = resolvedFlagsCount + resolvedReportsCount;
  const automationLast24h =
    (aiFlagsLast24hCount || 0) + (aiReportsLast24hCount || 0);
  const automationTotal = (aiFlagsTotalCount || 0) + (aiReportsTotalCount || 0);

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
