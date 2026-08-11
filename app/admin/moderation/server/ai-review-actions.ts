"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { checkSuperAdmin } from "../../actions";
import {
  analyzeProjectWithAi,
  analyzeReportWithAi,
  buildProjectFlagDetails,
} from "../ai-review";
import { takeModeratorAction } from "./enforcement";

export async function runAiReviewForReport(reportId: string) {
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
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: report, error: reportError } = await supabase
    .from("content_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    console.error("Error fetching report for AI review:", reportError);
    return { error: reportError.message };
  }

  if (!report) {
    return { error: "Report not found" };
  }

  let contentDetails = "";
  if (report.content_type === "project") {
    const { data: project } = await supabase
      .from("projects")
      .select("title, description")
      .eq("id", report.content_id)
      .maybeSingle();
    if (project) {
      contentDetails = `Project Title: ${project.title}\nProject Description: ${project.description || "N/A"}`;
    }
  } else if (report.content_type === "organization") {
    const { data: org } = await supabase
      .from("organizations")
      .select("name, description")
      .eq("id", report.content_id)
      .maybeSingle();
    if (org) {
      contentDetails = `Organization Name: ${org.name}\nOrganization Description: ${org.description || "N/A"}`;
    }
  } else if (report.content_type === "profile") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", report.content_id)
      .maybeSingle();
    if (profile) {
      contentDetails = `Profile: ${profile.full_name || profile.username || "Unknown user"}`;
    }
  }

  const { metadata, clampedStatus, triagedAt } = await analyzeReportWithAi(
    {
      id: report.id,
      reason: report.reason,
      description: report.description,
      content_type: report.content_type,
      content_id: report.content_id,
    },
    contentDetails,
  );

  const { error: updateError } = await supabase
    .from("content_reports")
    .update({
      priority: metadata.priority,
      status: clampedStatus,
      ai_metadata: metadata,
      updated_at: triagedAt,
    })
    .eq("id", report.id);

  if (updateError) {
    console.error("Error updating report after AI review:", updateError);
    return { error: updateError.message };
  }

  return { data: metadata };
}

/**
 * Run AI review for a single project
 */
export async function runAiReviewForProject(projectId: string) {
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
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title, description")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    console.error("Error fetching project for AI review:", projectError);
    return { error: projectError.message };
  }

  if (!project) {
    return { error: "Project not found" };
  }

  const decision = await analyzeProjectWithAi({
    id: project.id,
    title: project.title,
    description: project.description,
  });

  if (!decision.isFlagged) {
    return { data: { flagged: false, decision } };
  }

  const { data: existingFlags, error: existingError } = await supabase
    .from("content_flags")
    .select("id, status")
    .eq("content_type", "project")
    .eq("content_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) {
    console.error("Error checking existing flags:", existingError);
    return { error: existingError.message };
  }

  const flagPayload = {
    flag_type: decision.flagType ?? "other",
    confidence_score: decision.confidenceScore,
    flag_details: buildProjectFlagDetails(decision),
  };

  if (existingFlags && existingFlags.length > 0) {
    const { error: updateError } = await supabase
      .from("content_flags")
      .update({
        ...flagPayload,
      })
      .eq("id", existingFlags[0].id);

    if (updateError) {
      console.error(
        "Error updating existing flag after AI review:",
        updateError,
      );
      return { error: updateError.message };
    }

    return { data: { flagged: true, decision } };
  }

  const { error: insertError } = await supabase.from("content_flags").insert({
    content_type: "project",
    content_id: project.id,
    flag_source: "ai",
    status: "pending",
    ...flagPayload,
  });

  if (insertError) {
    console.error("Error inserting new flag after AI review:", insertError);
    return { error: insertError.message };
  }

  await notifyAdminsBatched({
    type: "flagged_content",
    contentId: project.id,
    contentType: "project",
    flagType: decision.flagType ?? "other",
    confidenceScore: decision.confidenceScore,
  });

  return { data: { flagged: true, decision } };
}

/**
 * Apply the AI recommendation for a report
 */
export async function applyAiRecommendationForReport(reportId: string) {
  "use server";
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: report, error } = await supabase
    .from("content_reports")
    .select("id, reason, ai_metadata")
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching report for AI action:", error);
    return { error: error.message };
  }

  if (!report) {
    return { error: "Report not found" };
  }

  const recommendedAction = report.ai_metadata?.recommendedAction as
    | "none"
    | "warn_user"
    | "remove_content"
    | "block_content"
    | "escalate_to_legal"
    | undefined;

  if (!recommendedAction || recommendedAction === "none") {
    return { error: "No actionable AI recommendation available" };
  }

  const reason =
    report.ai_metadata?.actionJustification ||
    report.ai_metadata?.shortSummary ||
    report.reason ||
    "Applied AI recommendation";

  return takeModeratorAction(reportId, recommendedAction, reason);
}

export async function runAiScan() {
  "use server";
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  try {
    const { performAiModerationScan } = await import("../ai-scan-logic");
    const result = await performAiModerationScan();
    if (
      result?.applied?.projectFlags?.length ||
      result?.applied?.reportTriages?.length
    ) {
      await notifyAdminsBatched({
        type: "flagged_content",
        contentId: "batch",
        contentType: "ai_scan",
        flagType: "scan_results",
      });
    }
    return { success: true, data: result };
  } catch (e) {
    console.error("AI scan exception:", e);
    return {
      error: `Scan failed: ${e instanceof Error ? e.message : "Unknown error"}`,
    };
  }
}
