"use server";

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { checkSuperAdmin } from "./auth";
import {
  extractMetadataModeration,
  isMissingFeedbackModerationTableError,
  isObjectRecord,
  type FeedbackModerationRow,
  type FeedbackModerationStatus,
} from "./shared";

export async function getAllFeedback() {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("feedback")
    .select(
      `
      id,
      user_id,
      section,
      email,
      title,
      feedback,
      page_path,
      metadata,
      created_at
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching feedback:", error);
    return { error: "Failed to fetch feedback" };
  }

  if (!data || data.length === 0) {
    return { data: [] };
  }

  const userIds = [...new Set(data.map((item) => item.user_id))];
  const feedbackIds = data.map((item) => item.id);

  const [
    { data: profiles, error: profileError },
    { data: moderationRows, error: moderationError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds),
    supabase
      .from("feedback_moderation")
      .select(
        "feedback_id, status, reviewed_by, reviewed_at, notes, updated_at",
      )
      .in("feedback_id", feedbackIds),
  ]);

  if (profileError) {
    console.error("Error fetching feedback profiles:", profileError);
  }

  if (
    moderationError &&
    !isMissingFeedbackModerationTableError(moderationError)
  ) {
    console.error(
      "Error fetching feedback moderation states:",
      moderationError,
    );
  }

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const moderationMap = new Map<string, FeedbackModerationRow>(
    ((moderationRows as FeedbackModerationRow[] | null) || []).map((row) => [
      row.feedback_id,
      row,
    ]),
  );

  const enrichedFeedback = data.map((item) => {
    const metadataModeration = extractMetadataModeration(item.metadata);
    const moderation = moderationMap.get(item.id);

    return {
      ...item,
      profiles: profileMap.get(item.user_id) || null,
      moderation_status: (moderation?.status ||
        metadataModeration?.status ||
        "pending") as FeedbackModerationStatus,
      moderation_notes: moderation?.notes ?? metadataModeration?.notes ?? null,
      moderation_reviewed_at:
        moderation?.reviewed_at ?? metadataModeration?.reviewed_at ?? null,
      moderation_reviewed_by:
        moderation?.reviewed_by ?? metadataModeration?.reviewed_by ?? null,
    };
  });

  return { data: enrichedFeedback };
}

export async function deleteFeedback(feedbackId: string) {
  "use server";
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const { error } = await supabase
    .from("feedback")
    .delete()
    .eq("id", feedbackId);

  if (error) {
    console.error("Error deleting feedback:", error);
    return { error: "Failed to delete feedback" };
  }

  return { success: true };
}

export async function updateFeedbackModerationStatus(input: {
  feedbackId: string;
  status: FeedbackModerationStatus;
  notes?: string;
}) {
  "use server";
  const supabase = getAdminClient();
  const viewerSupabase = await createClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  if (!input.feedbackId) {
    return { error: "Feedback ID is required" };
  }

  if (!["pending", "approved", "flagged", "archived"].includes(input.status)) {
    return { error: "Invalid moderation status" };
  }

  const {
    data: { user },
  } = await viewerSupabase.auth.getUser();

  if (input.status === "pending") {
    const { error } = await supabase
      .from("feedback_moderation")
      .delete()
      .eq("feedback_id", input.feedbackId);

    if (error) {
      if (isMissingFeedbackModerationTableError(error)) {
        const { data: feedbackRow, error: feedbackReadError } = await supabase
          .from("feedback")
          .select("metadata")
          .eq("id", input.feedbackId)
          .maybeSingle();

        if (feedbackReadError) {
          console.error(
            "Error loading feedback metadata fallback:",
            feedbackReadError,
          );
          return { error: "Failed to reset moderation status" };
        }

        const metadata = isObjectRecord(feedbackRow?.metadata)
          ? { ...feedbackRow.metadata }
          : {};

        delete metadata.adminModeration;

        const { error: feedbackUpdateError } = await supabase
          .from("feedback")
          .update({ metadata })
          .eq("id", input.feedbackId);

        if (feedbackUpdateError) {
          console.error(
            "Error resetting metadata moderation fallback:",
            feedbackUpdateError,
          );
          return { error: "Failed to reset moderation status" };
        }

        return { success: true };
      }

      console.error("Error clearing feedback moderation status:", error);
      return { error: "Failed to reset moderation status" };
    }

    return { success: true };
  }

  const normalizedNotes = input.notes?.trim() || null;
  const now = new Date().toISOString();

  const { error } = await supabase.from("feedback_moderation").upsert(
    {
      feedback_id: input.feedbackId,
      status: input.status,
      notes: normalizedNotes,
      reviewed_by: user?.id || null,
      reviewed_at: now,
      updated_at: now,
    },
    { onConflict: "feedback_id" },
  );

  if (error) {
    if (isMissingFeedbackModerationTableError(error)) {
      const { data: feedbackRow, error: feedbackReadError } = await supabase
        .from("feedback")
        .select("metadata")
        .eq("id", input.feedbackId)
        .maybeSingle();

      if (feedbackReadError) {
        console.error(
          "Error loading feedback metadata fallback:",
          feedbackReadError,
        );
        return { error: "Failed to update moderation status" };
      }

      const metadata = isObjectRecord(feedbackRow?.metadata)
        ? { ...feedbackRow.metadata }
        : {};

      metadata.adminModeration = {
        status: input.status,
        notes: normalizedNotes,
        reviewedAt: now,
        reviewedBy: user?.id || null,
      };

      const { error: feedbackUpdateError } = await supabase
        .from("feedback")
        .update({ metadata })
        .eq("id", input.feedbackId);

      if (feedbackUpdateError) {
        console.error(
          "Error updating metadata moderation fallback:",
          feedbackUpdateError,
        );
        return { error: "Failed to update moderation status" };
      }

      return { success: true };
    }

    console.error("Error updating feedback moderation:", error);
    return { error: "Failed to update moderation status" };
  }

  return { success: true };
}
