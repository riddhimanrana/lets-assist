import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "@/services/notifications";
import { checkSuperAdmin } from "../../actions";
import {
  matchesReportStatusFilter,
  normalizeReportStatus,
} from "../report-status";
import { notifyReporterOfReportUpdate } from "./notifications";

type ProjectSummary = {
  id: string;
  title: string | null;
  creator_id: string | null;
};

type ProfileSummary = {
  id: string;
  full_name: string | null;
  email?: string | null;
  username: string | null;
  avatar_url: string | null;
};

/**
 * Get all content reports for admin review
 */
export async function getContentReports(
  status?: "pending" | "under_review" | "resolved" | "dismissed" | "escalated",
) {
  "use server";
  const supabase = getAdminClient();

  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: rawReports, error } = await supabase
    .from("content_reports")
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching content reports:", error);
    return { error: error.message };
  }

  const normalizedReports = (rawReports || []).map((report) => ({
    ...report,
    status: normalizeReportStatus(report.status),
  }));

  const reports = normalizedReports.filter((report) =>
    matchesReportStatusFilter(report.status, status),
  );

  if (reports.length === 0) {
    return { data: [] };
  }

  // Manually fetch reporter and reviewer profiles
  if (reports) {
    const reporterIds = reports
      .map((r) => r.reporter_id)
      .filter((id): id is string => id !== null);

    const reviewerIds = reports
      .map((r) => r.reviewed_by)
      .filter((id): id is string => id !== null);

    const allUserIds = [...new Set([...reporterIds, ...reviewerIds])];

    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email, username")
        .in("id", allUserIds);

      const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

      // Fetch content details based on type
      const projectIds = reports
        .filter((r) => r.content_type === "project")
        .map((r) => r.content_id);
      const profileIds = reports
        .filter((r) => r.content_type === "profile")
        .map((r) => r.content_id);

      let projects: ProjectSummary[] = [];
      if (projectIds.length > 0) {
        const { data: p } = await supabase
          .from("projects")
          .select("id, title, creator_id")
          .in("id", projectIds);
        projects = p || [];
      }

      let profilesContent: ProfileSummary[] = [];
      if (profileIds.length > 0) {
        const { data: p } = await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url")
          .in("id", profileIds);
        profilesContent = p || [];
      }

      // Fetch creators for projects
      const projectCreatorIds = projects
        .map((p) => p.creator_id)
        .filter(Boolean);
      let projectCreators: ProfileSummary[] = [];
      if (projectCreatorIds.length > 0) {
        const { data: pc } = await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url")
          .in("id", projectCreatorIds);
        projectCreators = pc || [];
      }

      const projectCreatorMap = new Map(projectCreators.map((p) => [p.id, p]));

      // Enhance data with profile info and content details
      const enhancedData = reports.map((report) => {
        let contentDetails = null;
        let creatorDetails = null;

        if (report.content_type === "project") {
          const project = projects.find((p) => p.id === report.content_id);
          contentDetails = project;
          if (project && project.creator_id) {
            creatorDetails = projectCreatorMap.get(project.creator_id);
          }
        } else if (report.content_type === "profile") {
          const profile = profilesContent.find(
            (p) => p.id === report.content_id,
          );
          contentDetails = profile;
          creatorDetails = profile;
        }

        return {
          ...report,
          reporter: report.reporter_id
            ? profileMap.get(report.reporter_id)
            : null,
          reviewer: report.reviewed_by
            ? profileMap.get(report.reviewed_by)
            : null,
          content_details: contentDetails,
          creator_details: creatorDetails,
        };
      });

      return { data: enhancedData };
    }
  }

  return { data: reports };
}

/**
 * Update content report status
 */
export async function updateContentReportStatus(
  id: string,
  status: "pending" | "under_review" | "resolved" | "dismissed",
  resolutionNotes?: string,
) {
  "use server";
  const viewerSupabase = await createClient();
  const supabase = getAdminClient(); // Use service role to bypass RLS

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const {
    data: { user },
  } = await viewerSupabase.auth.getUser();

  // First check if the report exists (using service role)
  const { data: existingReports, error: checkError } = await supabase
    .from("content_reports")
    .select("id, reporter_id, reason, content_type, content_id")
    .eq("id", id);

  if (checkError) {
    console.error("Error checking report:", id, checkError);
    return { error: `Failed to check report: ${checkError.message}` };
  }

  if (!existingReports || existingReports.length === 0) {
    console.error("Report not found:", id);
    return { error: "Report not found" };
  }

  const { data, error } = await supabase
    .from("content_reports")
    .update({
      status,
      reviewed_by: user?.id,
      reviewed_at:
        status === "resolved" || status === "dismissed"
          ? new Date().toISOString()
          : null,
      resolution_notes: resolutionNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select();

  if (error) {
    console.error("Error updating content report:", error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    console.error("No data returned after update for report:", id);
    return { error: "Failed to update report" };
  }

  const updatedReport = data[0];

  if (
    (status === "resolved" || status === "dismissed") &&
    updatedReport?.reporter_id
  ) {
    await notifyReporterOfReportUpdate({
      supabase,
      report: updatedReport,
      status,
      resolutionNotes,
    });
  }

  return {
    data: updatedReport,
    message:
      status === "resolved"
        ? "Case resolved. Reporter was notified."
        : status === "dismissed"
          ? "Case dismissed. Reporter was notified."
          : "Report updated",
  };
}

/**
 * Send feedback to a user regarding their report
 */
type ReportSummary = {
  description?: string | null;
  reason?: string | null;
};

export async function sendReportFeedback(
  reportId: string,
  userId: string | null | undefined,
  message: string,
  status: "resolved" | "investigating" | "dismissed",
  reportSummary?: ReportSummary,
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

  const resolvedAt = new Date().toISOString();
  const normalizedStatus = status === "investigating" ? "under_review" : status;

  const { data: updateData, error: updateError } = await supabase
    .from("content_reports")
    .update({
      status: normalizedStatus,
      resolution_notes: message,
      reviewed_by: user?.id ?? null,
      reviewed_at: resolvedAt,
      updated_at: resolvedAt,
    })
    .eq("id", reportId)
    .select("id");

  if (updateError) {
    return { error: updateError.message };
  }

  if (!updateData || updateData.length === 0) {
    return { error: "Report not found" };
  }

  if (userId) {
    await NotificationService.createNotification(
      {
        title: "Update on your report",
        body: message,
        type: "general",
        severity: "info",
        data: {
          modalType: "report-feedback",
          reportId,
          message,
          status: normalizedStatus,
          resolvedAt,
          reportDescription: reportSummary?.description,
          reportReason: reportSummary?.reason,
        },
      },
      userId,
    );
  }

  return { success: true };
}

/**
 * Get content reports statistics
 */
export async function getContentReportsStats() {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  // Get total counts
  const { count: totalReports } = await supabase
    .from("content_reports")
    .select("*", { count: "exact", head: true });

  const { data: reportStatuses } = await supabase
    .from("content_reports")
    .select("status");

  const pendingCount = (reportStatuses || []).filter((report) =>
    matchesReportStatusFilter(report.status, "pending"),
  ).length;

  const resolvedCount = (reportStatuses || []).filter((report) =>
    matchesReportStatusFilter(report.status, "resolved"),
  ).length;

  const { count: highPriorityCount } = await supabase
    .from("content_reports")
    .select("*", { count: "exact", head: true })
    .in("priority", ["high", "critical"]);

  // Get recent reports (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { count: recentCount } = await supabase
    .from("content_reports")
    .select("*", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo.toISOString());

  return {
    data: {
      total: totalReports || 0,
      pending: pendingCount || 0,
      resolved: resolvedCount || 0,
      highPriority: highPriorityCount || 0,
      recentWeek: recentCount || 0,
    },
  };
}

export async function getDetailedReportWithContext(reportId: string) {
  "use server";
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required", data: undefined };
  }

  try {
    console.log(`[getDetailedReportWithContext] Fetching report: ${reportId}`);

    // Get the report
    const { data: reportList, error: reportError } = await supabase
      .from("content_reports")
      .select("*")
      .eq("id", reportId);

    console.log(`[getDetailedReportWithContext] Query result:`, {
      reportList,
      reportError,
      count: reportList?.length,
    });

    if (reportError) {
      console.error(`[getDetailedReportWithContext] Error:`, reportError);
      return {
        error: `Failed to fetch report: ${reportError.message}`,
        data: undefined,
      };
    }

    if (!reportList || reportList.length === 0) {
      console.error(
        `[getDetailedReportWithContext] Report not found with ID: ${reportId}`,
      );
      return { error: "Report not found", data: undefined };
    }

    const report = reportList[0];
    console.log(`[getDetailedReportWithContext] Found report:`, {
      id: report.id,
      status: report.status,
    });

    // Get reporter profile
    const { data: reporterList } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .eq("id", report.reporter_id);

    const reporterProfile = reporterList?.[0] || null;

    // Get reviewer profile if reviewed
    const { data: reviewerList } = report.reviewed_by
      ? await supabase
          .from("profiles")
          .select("id, full_name, username")
          .eq("id", report.reviewed_by)
      : { data: null };

    const reviewerProfile = reviewerList?.[0] || null;

    // Get content details based on content_type
    let contentDetails: unknown = null;
    let creatorProfile = null;

    if (report.content_type === "project") {
      const { data: projectList } = await supabase
        .from("projects")
        .select(
          "id, title, description, creator_id, organization_id, status, created_at",
        )
        .eq("id", report.content_id);

      const project = projectList?.[0];
      if (project) {
        contentDetails = project;
        const { data: creatorList } = await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url")
          .eq("id", project.creator_id);
        creatorProfile = creatorList?.[0] || null;

        // Get organization if exists
        if (project.organization_id) {
          const { data: orgList } = await supabase
            .from("organizations")
            .select("id, name, username, type, verified")
            .eq("id", project.organization_id);
          if (orgList?.[0]) {
            (contentDetails as Record<string, unknown>).organization =
              orgList[0];
          }
        }
      }
    } else if (report.content_type === "organization") {
      const { data: orgList } = await supabase
        .from("organizations")
        .select("id, name, username, description, type, verified, created_by")
        .eq("id", report.content_id);

      const org = orgList?.[0];
      if (org) {
        contentDetails = org;
        const { data: creatorList } = await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url")
          .eq("id", org.created_by);
        creatorProfile = creatorList?.[0] || null;
      }
    }

    return {
      success: true,
      data: {
        report,
        reporter: reporterProfile,
        reviewer: reviewerProfile,
        content: contentDetails,
        creator: creatorProfile,
      },
    };
  } catch (e) {
    console.error("Error fetching detailed report:", e);
    return {
      error: `Failed to fetch report: ${e instanceof Error ? e.message : "Unknown error"}`,
      data: undefined,
    };
  }
}
