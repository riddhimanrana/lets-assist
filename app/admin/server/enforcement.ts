import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type { AccountAccessStatus } from "@/lib/auth/account-access";
import { sendEmail } from "@/services/email";
import AccountAccessUpdateEmail from "@/emails/account-access-update";
import { checkSuperAdmin } from "./auth";
import { createServerNotification, readBannedUntil } from "./shared";

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
  "use server";
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
    targetAuthUser.app_metadata &&
    typeof targetAuthUser.app_metadata === "object"
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

    const { data: banResult, error: banError } =
      await service.auth.admin.updateUserById(input.userId, {
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

    const bannedUntilBan = readBannedUntil(banResult?.user);
    return {
      data: {
        userId: input.userId,
        status: "banned",
        reason: normalizedReason,
        updatedAt,
        bannedUntil: bannedUntilBan,
      },
    };
  }

  // --- ACTIVE (unban) --------------------------------------------------------
  // Supabase merges app_metadata rather than replacing it, so we must
  // explicitly set account_access to null to clear the old banned status.
  const { data: activeResult, error: activeError } =
    await service.auth.admin.updateUserById(input.userId, {
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
      react: AccountAccessUpdateEmail({
        userName,
        status: "active",
        reason: null,
        supportUrl,
      }),
      userId: input.userId,
      type: "transactional",
    });
  }

  const bannedUntilActive = readBannedUntil(activeResult?.user);
  return {
    data: {
      userId: input.userId,
      status: "active",
      reason: null,
      updatedAt,
      bannedUntil: bannedUntilActive,
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
  "use server";
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
        {
          email: normalizedEmail,
          reason: normalizedReason,
          banned_by: adminUserId,
        },
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
    const { error } = await service
      .from(table)
      .delete()
      .eq(field, input.userId);
    if (error) console.error(`Delete cleanup: ${table}:`, error);
  }
  await service
    .from("organization_members")
    .delete()
    .eq("user_id", input.userId);
  await service.from("projects").delete().eq("creator_id", input.userId);
  await service.from("profiles").delete().eq("id", input.userId);

  // Ban auth row so active sessions are immediately invalidated
  const updatedAt = new Date().toISOString();
  const { error: banError } = await service.auth.admin.updateUserById(
    input.userId,
    {
      ban_duration: "876000h",
      app_metadata: {
        account_access: {
          status: "banned",
          reason: normalizedReason,
          updated_at: updatedAt,
          updated_by: adminUserId,
        },
      },
    },
  );
  if (banError) {
    console.error("Error banning auth row after data deletion:", banError);
  }

  return { success: true };
}
