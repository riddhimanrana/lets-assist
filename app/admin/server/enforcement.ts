"use server";

import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type { AccountAccessStatus } from "@/lib/auth/account-access";
import {
  accountDeletionFailureMessage,
  deleteUserWithCleanup,
} from "@/lib/supabase/delete-user-with-cleanup";
import {
  settleEnforcementEmail,
  type EnforcementEmailState,
} from "@/lib/admin/enforcement-email";
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
   * Used in the email. banDurationHours controls the block duration.
   */
  banDurationLabel?: string;
  /**
   * Supabase ban_duration string for timed bans (e.g. "24h", "168h").
   * Omit for indefinite bans. The default is "876000h".
   */
  banDurationHours?: string;
  sendEmail?: boolean;
  sendNotification?: boolean;
}): Promise<
  {
    data?: {
      userId: string;
      status: AccountAccessStatus;
      reason: string | null;
      updatedAt: string;
      bannedUntil: string | null;
    };
    error?: string;
  } & Partial<EnforcementEmailState>
> {
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

  let emailState: EnforcementEmailState = {
    emailDelivery: "not_attempted",
    ...(shouldSendEmail && !userEmail
      ? {
          warning:
            "Account change saved. No email address was available for its notice.",
        }
      : {}),
  };

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
      emailState = await settleEnforcementEmail(() =>
        sendEmail({
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
          idempotencyKey: `account-access/${input.userId}/${updatedAt}/banned`,
        }),
      );
    }

    const bannedUntilBan = readBannedUntil(banResult?.user);
    return {
      ...emailState,
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
    emailState = await settleEnforcementEmail(() =>
      sendEmail({
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
        idempotencyKey: activeResult?.user?.updated_at
          ? `account-access/${input.userId}/${activeResult.user.updated_at}/active`
          : undefined,
      }),
    );
  }

  const bannedUntilActive = readBannedUntil(activeResult?.user);
  return {
    ...emailState,
    data: {
      userId: input.userId,
      status: "active",
      reason: null,
      updatedAt,
      bannedUntil: bannedUntilActive,
    },
  };
}

/** Remove personal records through the same recoverable protocol as self-deletion. */
export async function deleteAndBlacklistUser(input: {
  userId: string;
  reason?: string;
  sendEmail?: boolean;
}): Promise<
  { success?: boolean; error?: string } & Partial<EnforcementEmailState>
> {
  "use server";
  const { isAdmin, userId: adminUserId } = await checkSuperAdmin();
  if (!isAdmin || !adminUserId) return { error: "Unauthorized" };
  if (!input.userId) return { error: "User ID is required" };
  if (input.userId === adminUserId)
    return { error: "You cannot delete your own account via this panel." };
  const service = getAdminClient();
  try {
    const report = await deleteUserWithCleanup(service, input.userId, {
      actorId: adminUserId,
      mode: "admin_blacklist",
      reason: input.reason,
      deleteProjects: true,
    });
    if (report.phase !== "completed")
      return { error: accountDeletionFailureMessage(report) };
    let emailState: EnforcementEmailState = { emailDelivery: "not_attempted" };
    // Send only after confirmed completion. A retry of a completed receipt does
    // not send again. A failed notification does not undo account removal.
    if (report.completedNow && input.sendEmail !== false) {
      try {
        const { data } = await service.auth.admin.getUserById(input.userId);
        const recipient = data.user?.email;
        if (recipient) {
          emailState = await settleEnforcementEmail(() =>
            sendEmail({
              to: recipient,
              subject: "Your Let's Assist account has been permanently removed",
              react: AccountAccessUpdateEmail({
                userName: "there",
                status: "banned",
                reason: input.reason?.trim() || null,
                banDuration: "indefinitely",
                supportUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com"}/help`,
              }),
              userId: input.userId,
              type: "transactional",
              idempotencyKey: `account-removal/${report.operationId}`,
            }),
          );
        } else {
          emailState = {
            emailDelivery: "not_attempted",
            warning:
              "Account removal completed. No email address was available for its notice.",
          };
        }
      } catch {
        emailState = {
          emailDelivery: "not_attempted",
          warning:
            "Account removal completed. Its email could not be prepared.",
        };
      }
    }
    return { success: true, ...emailState };
  } catch {
    return {
      error:
        "Account cleanup could not be confirmed. Retry the saved operation.",
    };
  }
}
