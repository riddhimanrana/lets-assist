"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import type { AccountAccessStatus } from "@/lib/auth/account-access";
import { readAccountAccessFromMetadata } from "@/lib/auth/account-access";
import { sendEmail } from "@/services/email";
import AccountAccessUpdateEmail from "@/emails/account-access-update";
import { hasSuperAdminMetadata } from "@/lib/auth/super-admin";

type NotificationSeverity = "info" | "warning" | "success";
type FeedbackModerationStatus = "pending" | "approved" | "flagged" | "archived";

type FeedbackModerationRow = {
  feedback_id: string;
  status: Exclude<FeedbackModerationStatus, "pending">;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  updated_at: string;
};

type FeedbackModerationSnapshot = {
  status: FeedbackModerationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractMetadataModeration(metadata: unknown): FeedbackModerationSnapshot | null {
  if (!isObjectRecord(metadata)) {
    return null;
  }

  const candidate = metadata.adminModeration;
  if (!isObjectRecord(candidate)) {
    return null;
  }

  const statusRaw = typeof candidate.status === "string" ? candidate.status : "pending";
  const normalizedStatus: FeedbackModerationStatus =
    statusRaw === "approved" || statusRaw === "flagged" || statusRaw === "archived"
      ? statusRaw
      : "pending";

  return {
    status: normalizedStatus,
    reviewed_by: typeof candidate.reviewedBy === "string" ? candidate.reviewedBy : null,
    reviewed_at: typeof candidate.reviewedAt === "string" ? candidate.reviewedAt : null,
    notes: typeof candidate.notes === "string" ? candidate.notes : null,
  };
}

function isMissingFeedbackModerationTableError(error: { code?: string; message?: string; hint?: string } | null) {
  if (!error) {
    return false;
  }

  const searchableText = `${error.message || ""} ${error.hint || ""}`.toLowerCase();

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    searchableText.includes("feedback_moderation")
  );
}

type UserAccessControlResult = {
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
    const { error } = await supabase
      .from("notifications")
      .insert({
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

export async function sendSystemNotification(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const title = formData.get("title") as string;
  const body = formData.get("body") as string;
  const severity = formData.get("severity") as NotificationSeverity;
  const targetUserId = formData.get("targetUserId") as string;
  const actionUrl = formData.get("actionUrl") as string;

  if (!title || !body) {
    return { error: "Title and Body are required." };
  }

  try {
    if (targetUserId === "all") {
      // Bulk insert for all users - this might be heavy, consider batching or background job for real prod
      // For now fetching top 1000 users or similar
      const supabase = getAdminClient();
      const { data: users, error } = await supabase.from('profiles').select('id');

      if (error || !users) return { error: "Failed to fetch users for broadcast." };

      const notifications = users.map(u => ({
        user_id: u.id,
        title,
        body,
        type: "admin_broadcast",
        severity,
        action_url: actionUrl || null,
        displayed: false,
        read: false,
      }));

      const { error: insertError } = await supabase.from('notifications').insert(notifications);
      if (insertError) {
        console.error('Broadcast error:', insertError);
        return { error: "Failed to send broadcast." };
      }

    } else {
      // Single user
      await createServerNotification(targetUserId, title, body, severity, actionUrl || undefined);
    }

    return { success: true, message: "Notification sent successfully." };

  } catch (err) {
    console.error("Error sending notification:", err);
    return { error: "Internal Server Error" };
  }
}

export async function checkSuperAdmin() {
  // Get current user using getClaims() for better performance
  const { user } = await getAuthUser();

  if (!user) {
    return { isAdmin: false };
  }

  try {
    return { isAdmin: hasSuperAdminMetadata(user), userId: user.id };
  } catch (err) {
    console.error("Exception checking super admin status:", err);
    return { isAdmin: false };
  }
}

export async function getAllFeedback() {
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("feedback")
    .select(`
      id,
      user_id,
      section,
      email,
      title,
      feedback,
      page_path,
      metadata,
      created_at
    `)
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

  const [{ data: profiles, error: profileError }, { data: moderationRows, error: moderationError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds),
    supabase
      .from("feedback_moderation")
      .select("feedback_id, status, reviewed_by, reviewed_at, notes, updated_at")
      .in("feedback_id", feedbackIds),
  ]);

  if (profileError) {
    console.error("Error fetching feedback profiles:", profileError);
  }

  if (moderationError && !isMissingFeedbackModerationTableError(moderationError)) {
    console.error("Error fetching feedback moderation states:", moderationError);
  }

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const moderationMap = new Map<string, FeedbackModerationRow>(
    ((moderationRows as FeedbackModerationRow[] | null) || []).map((row) => [row.feedback_id, row]),
  );

  const enrichedFeedback = data.map((item) => {
    const metadataModeration = extractMetadataModeration(item.metadata);
    const moderation = moderationMap.get(item.id);

    return {
      ...item,
      profiles: profileMap.get(item.user_id) || null,
      moderation_status: (moderation?.status || metadataModeration?.status || "pending") as FeedbackModerationStatus,
      moderation_notes: moderation?.notes ?? metadataModeration?.notes ?? null,
      moderation_reviewed_at: moderation?.reviewed_at ?? metadataModeration?.reviewed_at ?? null,
      moderation_reviewed_by: moderation?.reviewed_by ?? metadataModeration?.reviewed_by ?? null,
    };
  });

  return { data: enrichedFeedback };
}

export async function getTrustedMemberApplications() {
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("trusted_member")
    .select(`
      id,
      user_id,
      name,
      email,
      reason,
      status,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching trusted member applications:", error);
    return { error: "Failed to fetch applications" };
  }

  if (data && data.length > 0) {
    const userIds = [...new Set(data.map((item) => item.user_id || item.id))];

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", userIds);

    if (!profileError && profiles) {
      const profileMap = new Map(profiles.map((p) => [p.id, p]));
      const applicationsWithProfiles = data.map((item) => ({
        ...item,
        profiles: profileMap.get(item.user_id || item.id) || null,
      }));

      return { data: applicationsWithProfiles };
    }
  }

  const applicationsWithNullProfiles = (data || []).map((item) => ({
    ...item,
    profiles: null,
  }));

  return { data: applicationsWithNullProfiles };
}

export async function updateTrustedMemberStatus(userId: string, status: boolean) {
  // Require user and admin as you already do
  const supabaseUser = await createClient();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Perform the write with the service-role client to bypass RLS
  const service = getAdminClient();

  // Try user_id match first
  const { error: userIdError } = await service
    .from("trusted_member")
    .update({ status })
    .eq("user_id", userId);

  if (userIdError) {
    // Fallback to id match
    const { error: idError } = await service
      .from("trusted_member")
      .update({ status })
      .eq("id", userId);

    if (idError) {
      console.error("Error updating trusted_member status:", idError);
      return { error: "Failed to update trusted member status" };
    }
  }

  await service
    .from("profiles")
    .update({ trusted_member: status })
    .eq("id", userId);

  // Send notification with service client (already bypasses RLS)
  if (status === true) {
    await createServerNotification(
      userId,
      "Trusted Member Application Approved!",
      "Congratulations! Your trusted member application has been approved. You can now create projects and organizations.",
      "success",
      "/trusted-member"
    );
  } else {
    await createServerNotification(
      userId,
      "Trusted Member Application Update",
      "Thank you for your interest in becoming a trusted member. Unfortunately, your application was not approved at this time. Please contact support for more information.",
      "warning",
      "/trusted-member"
    );
  }

  return { success: true };
}

export async function deleteFeedback(feedbackId: string) {
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
          console.error("Error loading feedback metadata fallback:", feedbackReadError);
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
          console.error("Error resetting metadata moderation fallback:", feedbackUpdateError);
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

  const { error } = await supabase
    .from("feedback_moderation")
    .upsert(
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
        console.error("Error loading feedback metadata fallback:", feedbackReadError);
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
        console.error("Error updating metadata moderation fallback:", feedbackUpdateError);
        return { error: "Failed to update moderation status" };
      }

      return { success: true };
    }

    console.error("Error updating feedback moderation:", error);
    return { error: "Failed to update moderation status" };
  }

  return { success: true };
}

export async function searchUsers(query: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Search in profiles table directly which is much more efficient than listUsers
  // and allows searching by name
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, email, avatar_url')
    .or(`full_name.ilike.%${query}%,email.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(5);

  if (error) {
    console.error("Error searching users:", error);
    return { error: "Failed to search users" };
  }

  if (!profiles || profiles.length === 0) return { data: [] };

  const results = profiles.map(p => ({
    id: p.id,
    email: p.email || "", // profiles should have email, fallback to empty if null
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    username: p.username
  }));

  return { data: results };
}

export async function addTrustedMember(userId: string, email: string, name: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) return { error: "Unauthorized" };

  // Check if already exists
  const { data: existing } = await supabase
    .from('trusted_member')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    return { error: "User is already in the trusted member list." };
  }

  const now = new Date().toISOString();
  // removed updated_at as it doesn't exist in the table
  const { error } = await supabase
    .from('trusted_member')
    .upsert({
      id: userId,
      user_id: userId,
      email,
      name,
      reason: 'Added manually by Admin',
      status: true,
      created_at: now,
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error("Error adding trusted member:", error);
    return { error: error.message };
  }

  await supabase
    .from('profiles')
    .update({ trusted_member: true })
    .eq('id', userId);

  await createServerNotification(
    userId,
    "You are now a Trusted Member! 🎉",
    "An admin has granted you trusted member status. You can now create projects and organizations.",
    "success",
    "/trusted-member"
  );

  return { success: true };
}

export async function getUserAccessControl(userId: string): Promise<{ data?: UserAccessControlResult; error?: string }> {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  if (!userId) {
    return { error: "User ID is required" };
  }

  const [{ data: profile }, authResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", userId)
      .maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ]);

  const targetAuthUser = authResult.data.user;
  if (authResult.error || !targetAuthUser) {
    return { error: "User not found" };
  }

  const access = readAccountAccessFromMetadata(targetAuthUser.app_metadata);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bannedUntil = (targetAuthUser as any).banned_until ?? null;

  return {
    data: {
      id: userId,
      email: targetAuthUser.email ?? profile?.email ?? null,
      fullName: profile?.full_name ?? null,
      username: profile?.username ?? null,
      bannedUntil: typeof bannedUntil === "string" ? bannedUntil : null,
      access,
    },
  };
}

export async function updateUserAccessControl(input: {
  userId: string;
  status: AccountAccessStatus;
  reason?: string;
  /**
   * For bans: human-readable label shown to the user (e.g. "7 days", "indefinitely").
   * Used in the email only—the actual block duration is supplied separately via banDurationHours.
   */
  banDurationLabel?: string;
  /**
   * Supabase ban_duration string for timed bans (e.g. "24h", "168h").
   * Omit for indefinite bans—defaults to "876000h" (~100 years).
   */
  banDurationHours?: string;
  sendEmail?: boolean;
  sendNotification?: boolean;
}): Promise<{
  data?: {
    userId: string;
    status: AccountAccessStatus;
    reason: string | null;
    updatedAt: string;
    bannedUntil: string | null;
  };
  error?: string;
}> {
  const service = getAdminClient();
  const { isAdmin, userId: adminUserId } = await checkSuperAdmin();

  if (!isAdmin || !adminUserId) {
    return { error: "Unauthorized" };
  }

  const normalizedReason = input.reason?.trim() || null;

  if (!input.userId) {
    return { error: "User ID is required" };
  }

  if (!["active", "banned"].includes(input.status)) {
    return { error: "Invalid access status" };
  }

  if (input.userId === adminUserId && input.status !== "active") {
    return { error: "You cannot ban your own account." };
  }

  if (input.status === "banned" && !normalizedReason) {
    return { error: "Please provide a reason for the ban." };
  }

  const [{ data: profile }, authResult] = await Promise.all([
    service
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", input.userId)
      .maybeSingle(),
    service.auth.admin.getUserById(input.userId),
  ]);

  const targetAuthUser = authResult.data.user;
  if (authResult.error || !targetAuthUser) {
    return { error: "User not found" };
  }

  const currentAppMetadata =
    targetAuthUser.app_metadata && typeof targetAuthUser.app_metadata === "object"
      ? ({ ...targetAuthUser.app_metadata } as Record<string, unknown>)
      : {};

  const updatedAt = new Date().toISOString();
  const userName = profile?.full_name || profile?.username || "there";
  const userEmail = targetAuthUser.email || profile?.email || null;
  const sendNotification = input.sendNotification !== false;
  const shouldSendEmail = input.sendEmail !== false;
  const supportUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com"}/help`;

  // --- BAN -------------------------------------------------------------------
  // Block via Supabase native ban_duration. User data is kept intact.
  // Use "876000h" (~100 years) for indefinite bans so the ban is still revocable.
  if (input.status === "banned") {
    const duration = input.banDurationHours ?? "876000h";
    const banMeta = {
      ...currentAppMetadata,
      account_access: {
        status: "banned",
        reason: normalizedReason,
        updated_at: updatedAt,
        updated_by: adminUserId,
      },
    };

    const { data: banResult, error: banError } = await service.auth.admin.updateUserById(input.userId, {
      ban_duration: duration,
      app_metadata: banMeta,
    });
    if (banError) {
      console.error("Error applying ban:", banError);
      return { error: "Failed to apply ban" };
    }

    if (sendNotification) {
      await createServerNotification(
        input.userId,
        "Account banned",
        `Your account has been banned. ${normalizedReason ? `Reason: ${normalizedReason}` : "Contact support for more information."}`,
        "warning",
        "/help",
      );
    }
    if (shouldSendEmail && userEmail) {
      await sendEmail({
        to: userEmail,
        subject: "Your Let's Assist account has been banned",
        react: AccountAccessUpdateEmail({
          userName,
          status: "banned",
          reason: normalizedReason,
          banDuration: input.banDurationLabel ?? "indefinitely",
          supportUrl,
        }),
        userId: input.userId,
        type: "transactional",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bannedUntilBan = (banResult?.user as any)?.banned_until ?? null;
    return {
      data: {
        userId: input.userId,
        status: "banned",
        reason: normalizedReason,
        updatedAt,
        bannedUntil: typeof bannedUntilBan === "string" ? bannedUntilBan : null,
      },
    };
  }

  // --- ACTIVE (unban) --------------------------------------------------------
  // Supabase merges app_metadata rather than replacing it, so we must
  // explicitly set account_access to null to clear the old banned status.
  const { data: activeResult, error: activeError } = await service.auth.admin.updateUserById(input.userId, {
    ban_duration: "none",
    app_metadata: { ...currentAppMetadata, account_access: null },
  });
  if (activeError) {
    console.error("Error restoring access:", activeError);
    return { error: "Failed to restore user access" };
  }

  if (sendNotification) {
    await createServerNotification(
      input.userId,
      "Account access restored",
      "Your account access has been restored. You can now sign in again.",
      "success",
      "/help",
    );
  }
  if (shouldSendEmail && userEmail) {
    await sendEmail({
      to: userEmail,
      subject: "Your Let's Assist account access has been restored",
      react: AccountAccessUpdateEmail({ userName, status: "active", reason: null, supportUrl }),
      userId: input.userId,
      type: "transactional",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bannedUntilActive = (activeResult?.user as any)?.banned_until ?? null;
  return {
    data: {
      userId: input.userId,
      status: "active",
      reason: null,
      updatedAt,
      bannedUntil: typeof bannedUntilActive === "string" ? bannedUntilActive : null,
    },
  };
}

/**
 * Permanently deletes all public data for a user AND adds their email to the
 * banned_emails blacklist so they can never register again with that address.
 * The auth.users row is preserved (banned) so any active sessions are killed.
 */
export async function deleteAndBlacklistUser(input: {
  userId: string;
  reason?: string;
  sendEmail?: boolean;
}): Promise<{ success?: boolean; error?: string }> {
  const service = getAdminClient();
  const { isAdmin, userId: adminUserId } = await checkSuperAdmin();

  if (!isAdmin || !adminUserId) {
    return { error: "Unauthorized" };
  }

  if (!input.userId) {
    return { error: "User ID is required" };
  }

  if (input.userId === adminUserId) {
    return { error: "You cannot delete your own account via this panel." };
  }

  const normalizedReason = input.reason?.trim() || null;

  const [{ data: profile }, authResult] = await Promise.all([
    service
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", input.userId)
      .maybeSingle(),
    service.auth.admin.getUserById(input.userId),
  ]);

  const targetAuthUser = authResult.data.user;
  if (authResult.error || !targetAuthUser) {
    return { error: "User not found" };
  }

  const userEmail = targetAuthUser.email || profile?.email || null;
  const userName = profile?.full_name || profile?.username || "there";
  const supportUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com"}/help`;
  const normalizedEmail = userEmail?.trim().toLowerCase() ?? null;

  // Email before deleting data
  if (input.sendEmail !== false && userEmail) {
    await sendEmail({
      to: userEmail,
      subject: "Your Let's Assist account has been permanently removed",
      react: AccountAccessUpdateEmail({
        userName,
        status: "banned",
        reason: normalizedReason,
        banDuration: "indefinitely",
        supportUrl,
      }),
      userId: input.userId,
      type: "transactional",
    });
  }

  // Add email to blacklist (upsert in case it already exists)
  if (normalizedEmail) {
    const { error: blacklistError } = await service
      .from("banned_emails")
      .upsert(
        { email: normalizedEmail, reason: normalizedReason, banned_by: adminUserId },
        { onConflict: "email" },
      );
    if (blacklistError) {
      console.error("Error adding email to blacklist:", blacklistError);
    }
  }

  // Delete all public user data
  const tables: Array<{ table: string; field: string }> = [
    { table: "content_reports", field: "reporter_id" },
    { table: "feedback", field: "user_id" },
    { table: "notifications", field: "user_id" },
    { table: "notification_settings", field: "user_id" },
    { table: "user_calendar_connections", field: "user_id" },
    { table: "user_emails", field: "user_id" },
    { table: "trusted_member", field: "user_id" },
    { table: "certificates", field: "user_id" },
    { table: "project_signups", field: "user_id" },
  ];
  for (const { table, field } of tables) {
    const { error } = await service.from(table).delete().eq(field, input.userId);
    if (error) console.error(`Delete cleanup: ${table}:`, error);
  }
  await service.from("organization_members").delete().eq("user_id", input.userId);
  await service.from("projects").delete().eq("creator_id", input.userId);
  await service.from("profiles").delete().eq("id", input.userId);

  // Ban auth row so active sessions are immediately invalidated
  const updatedAt = new Date().toISOString();
  const { error: banError } = await service.auth.admin.updateUserById(input.userId, {
    ban_duration: "876000h",
    app_metadata: {
      account_access: {
        status: "banned",
        reason: normalizedReason,
        updated_at: updatedAt,
        updated_by: adminUserId,
      },
    },
  });
  if (banError) {
    console.error("Error banning auth row after data deletion:", banError);
  }

  return { success: true };
}

export async function getOrganizationsForAdmin() {
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    redirect("/not-found");
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, username, type, verified, created_at, logo_url, created_by")
    .order("verified", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching organizations for admin:", error);
    return { error: "Failed to fetch organizations" };
  }

  return { data: data ?? [] };
}

export async function updateOrganizationVerifiedStatus(
  organizationId: string,
  verified: boolean,
) {
  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized" };
  }

  const service = getAdminClient();

  const { data: organization, error: fetchError } = await service
    .from("organizations")
    .select("id, name, username, created_by")
    .eq("id", organizationId)
    .maybeSingle();

  if (fetchError) {
    console.error("Error fetching organization before verification update:", fetchError);
    return { error: "Failed to load organization" };
  }

  if (!organization) {
    return { error: "Organization not found" };
  }

  const { error } = await service
    .from("organizations")
    .update({ verified })
    .eq("id", organizationId);

  if (error) {
    console.error("Error updating organization verification status:", error);
    return { error: "Failed to update verification status" };
  }

  if (organization.created_by) {
    await createServerNotification(
      organization.created_by,
      verified ? "Organization verified" : "Organization verification removed",
      verified
        ? `Your organization \"${organization.name}\" is now verified.`
        : `Verification for your organization \"${organization.name}\" has been removed.`,
      verified ? "success" : "warning",
      `/organization/${organization.username || organizationId}`,
    );
  }

  return { success: true };
}
