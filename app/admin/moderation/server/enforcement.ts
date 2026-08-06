"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { checkSuperAdmin } from "../../actions";
import { notifyContentOwnerOfModeration } from "./notifications";

export async function takeFlaggedContentAction(
  flagId: string,
  action: "warn_user" | "remove_content" | "block_content" | "dismiss",
  reason?: string,
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
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: flag, error: flagError } = await supabase
    .from("content_flags")
    .select("*")
    .eq("id", flagId)
    .maybeSingle();

  if (flagError) {
    console.error("Error fetching flagged content:", flagError);
    return { error: flagError.message };
  }

  if (!flag) {
    return { error: "Flagged content not found" };
  }

  let newStatus: "pending" | "blocked" | "confirmed" | "dismissed" = "pending";
  switch (action) {
    case "dismiss":
      newStatus = "dismissed";
      break;
    case "block_content":
      newStatus = "blocked";
      break;
    case "remove_content":
    case "warn_user":
    default:
      newStatus = "confirmed";
      break;
  }

  const { data, error } = await supabase
    .from("content_flags")
    .update({
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reason || `Action ${action}`,
    })
    .eq("id", flagId)
    .select();

  if (error) {
    console.error("Error updating flagged content:", error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    return { error: "Failed to update flagged content" };
  }

  if (
    (action === "remove_content" || action === "block_content") &&
    flag.content_id &&
    flag.content_type
  ) {
    await softRemoveContent(
      supabase,
      flag.content_type,
      flag.content_id,
      action,
      user.id,
      reason,
    );
  }

  if (
    action === "remove_content" ||
    action === "block_content" ||
    action === "warn_user"
  ) {
    await notifyContentOwnerOfModeration({
      supabase,
      contentType: flag.content_type,
      contentId: flag.content_id,
      action,
      reason: reason || flag.flag_type || "Policy violation",
    });
  }

  return { data: data[0] };
}

export async function takeModeratorAction(
  reportId: string,
  action:
    | "warn_user"
    | "remove_content"
    | "block_content"
    | "dismiss"
    | "escalate_to_legal",
  reason?: string,
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
  if (!user) {
    return { error: "No authenticated user" };
  }

  try {
    // Get the report
    const { data: report, error: reportError } = await supabase
      .from("content_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (reportError || !report) {
      return { error: `Report not found: ${reportError?.message}` };
    }

    // Map actions to corresponding status
    let newStatus = report.status;
    let actionNotes = "";

    switch (action) {
      case "dismiss":
        newStatus = "dismissed";
        actionNotes = "Content dismissed by moderator";
        break;
      case "remove_content":
        newStatus = "resolved";
        actionNotes = "Content removed by moderator";
        break;
      case "block_content":
        newStatus = "resolved";
        actionNotes = "Content blocked by moderator";
        break;
      case "warn_user":
        newStatus = "under_review";
        actionNotes = "User warned by moderator - awaiting compliance";
        break;
      case "escalate_to_legal":
        newStatus = "under_review";
        actionNotes = "Escalated to legal team for review";
        break;
    }

    // Update the report with action taken
    const resolutionNotes = [
      report.resolution_notes || "",
      `\n[Action taken] ${new Date().toISOString()}: ${actionNotes}${reason ? ` - ${reason}` : ""}`,
    ]
      .filter(Boolean)
      .join("");

    const { data, error } = await supabase
      .from("content_reports")
      .update({
        status: newStatus,
        resolution_notes: resolutionNotes,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .select()
      .single();

    if (error) {
      console.error(
        "Error taking moderator action on report %s:",
        reportId,
        error,
      );
      return { error: error.message };
    }

    // If removing/blocking content, also flag it in content_flags
    if (action === "remove_content" || action === "block_content") {
      const flagType = action === "remove_content" ? "removal" : "suspension";
      await supabase.from("content_flags").insert({
        content_type: report.content_type,
        content_id: report.content_id,
        flag_type: flagType,
        confidence_score: 1.0,
        flag_source: "moderator",
        status: "confirmed",
        flag_details: {
          action,
          reason,
          takenBy: user.id,
        },
      });
    }

    if (action === "remove_content" || action === "block_content") {
      await softRemoveContent(
        supabase,
        report.content_type,
        report.content_id,
        action,
        user.id,
        reason,
      );
    }

    if (
      action === "remove_content" ||
      action === "block_content" ||
      action === "warn_user"
    ) {
      await notifyContentOwnerOfModeration({
        supabase,
        contentType: report.content_type,
        contentId: report.content_id,
        action,
        reason: reason || actionNotes,
      });
    }

    return {
      success: true,
      data,
      message: `Action '${action}' taken on report ${reportId}`,
    };
  } catch (e) {
    console.error("Error taking moderator action:", e);
    return {
      error: `Failed to take action: ${e instanceof Error ? e.message : "Unknown error"}`,
    };
  }
}

export async function softRemoveContent(
  supabase: ReturnType<typeof getAdminClient>,
  contentType: string,
  contentId: string,
  action: "remove_content" | "block_content",
  adminUserId: string,
  reason?: string,
) {
  const now = new Date().toISOString();

  if (contentType === "project") {
    await supabase
      .from("projects")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancellation_reason: `Moderation ${action.replace("_", " ")}${reason ? `: ${reason}` : ""}`,
      })
      .eq("id", contentId);
    return;
  }

  if (contentType === "profile") {
    await supabase
      .from("profiles")
      .update({
        profile_visibility: "private",
        updated_at: now,
      })
      .eq("id", contentId);
    return;
  }

  if (contentType === "organization") {
    await supabase
      .from("organizations")
      .update({
        verified: false,
        updated_at: now,
      })
      .eq("id", contentId);
    return;
  }

  await notifyAdminsBatched({
    type: "content_report",
    reportId: contentId,
    reason: `Unsupported moderation removal for ${contentType}`,
    contentType,
    priority: "normal",
  });
}
