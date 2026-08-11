import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type { AccountAccessStatus } from "@/lib/auth/account-access";

export type NotificationSeverity = "info" | "warning" | "success";
export type FeedbackModerationStatus =
  "pending" | "approved" | "flagged" | "archived";

export type FeedbackModerationRow = {
  feedback_id: string;
  status: Exclude<FeedbackModerationStatus, "pending">;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  updated_at: string;
};

export type FeedbackModerationSnapshot = {
  status: FeedbackModerationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
};

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readBannedUntil(user: unknown): string | null {
  if (!isObjectRecord(user)) return null;
  return typeof user.banned_until === "string" ? user.banned_until : null;
}

export function extractMetadataModeration(
  metadata: unknown,
): FeedbackModerationSnapshot | null {
  if (!isObjectRecord(metadata)) {
    return null;
  }

  const candidate = metadata.adminModeration;
  if (!isObjectRecord(candidate)) {
    return null;
  }

  const statusRaw =
    typeof candidate.status === "string" ? candidate.status : "pending";
  const normalizedStatus: FeedbackModerationStatus =
    statusRaw === "approved" ||
    statusRaw === "flagged" ||
    statusRaw === "archived"
      ? statusRaw
      : "pending";

  return {
    status: normalizedStatus,
    reviewed_by:
      typeof candidate.reviewedBy === "string" ? candidate.reviewedBy : null,
    reviewed_at:
      typeof candidate.reviewedAt === "string" ? candidate.reviewedAt : null,
    notes: typeof candidate.notes === "string" ? candidate.notes : null,
  };
}

export function isMissingFeedbackModerationTableError(
  error: { code?: string; message?: string; hint?: string } | null,
) {
  if (!error) {
    return false;
  }

  const searchableText =
    `${error.message || ""} ${error.hint || ""}`.toLowerCase();

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    searchableText.includes("feedback_moderation")
  );
}

export type UserAccessControlResult = {
  id: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  bannedUntil: string | null;
  access: {
    status: AccountAccessStatus;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
};

export async function createServerNotification(
  userId: string,
  title: string,
  body: string,
  severity: NotificationSeverity = "info",
  actionUrl?: string,
) {
  const supabase = getAdminClient();

  try {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      title,
      body,
      type: "general",
      severity,
      action_url: actionUrl,
      displayed: false,
      read: false,
    });

    if (error) {
      console.error("Error creating notification:", error);
    }
  } catch (error) {
    console.error("Exception creating notification:", error);
  }
}
