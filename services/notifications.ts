import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { safeConsole } from "@/lib/safe-console";
import { isNotificationDedupeConflict } from "@/services/notification-dedupe";
import type {
  NotificationData,
  NotificationType,
} from "@/services/notification-types";

// The shapes moved to a client-agnostic module so server-only callers can
// describe a notification without importing this file, which pulls in the
// browser Supabase client and sonner. Re-exported so existing importers of
// "@/services/notifications" keep working.
export type {
  NotificationData,
  NotificationSeverity,
  NotificationType,
} from "@/services/notification-types";

export const NotificationService = {
  async createNotification(
    notification: NotificationData,
    userId: string,
    _showToast = false,
  ) {
    const supabase = createClient();

    // Set default severity to 'info' if not specified
    const notificationWithSeverity = {
      ...notification,
      severity: notification.severity || "info",
    };

    try {
      if (
        notification.type === "organization_updates" ||
        notification.type === "project_updates" ||
        notification.type === "email_notifications" ||
        notification.type === "general"
      ) {
        // Define NotificationPreferences type inline for query result
        interface NotificationPreferences {
          email_notifications: boolean;
          project_updates: boolean;
          general?: boolean;
          [key: string]: boolean | undefined;
        }
        // Get user's notification preferences as a single object
        const { data: preferences, error: prefsError } = await supabase
          .from("notification_settings")
          .select("*")
          .eq("user_id", userId)
          .single<NotificationPreferences>();

        if (prefsError && prefsError.code !== "PGRST116") {
          // PGRST116 means "no rows returned"
          safeConsole.error("Notification preferences lookup failed");
          return { error: prefsError };
        }

        // If user has disabled this notification type, don't create notification
        if (preferences?.[notification.type] === false) {
          return { success: false, skipped: true };
        }
      }

      // Insert into notifications table without showing toast directly
      // The real-time listener will handle showing the toast
      const { data, error } = await supabase.from("notifications").insert({
        user_id: userId,
        title: notificationWithSeverity.title,
        body: notificationWithSeverity.body,
        type: notificationWithSeverity.type,
        severity: notificationWithSeverity.severity,
        action_url: notificationWithSeverity.actionUrl,
        data: notificationWithSeverity.data,
        dedupe_key: notificationWithSeverity.dedupeKey,
        displayed: false, // Start as not displayed, let the listener handle it
      });

      if (error) {
        if (isNotificationDedupeConflict(error, notification.dedupeKey)) {
          return { success: true, existing: true, replayed: true };
        }

        throw error;
      }

      // Don't manually show toast here - let the realtime listener handle it

      return { success: true, data };
    } catch (error) {
      safeConsole.error("Notification creation failed");
      return { error };
    }
  },

  async markAsDisplayed(
    userId: string,
    type: NotificationType,
    dedupeKey?: string,
  ) {
    const supabase = createClient();

    try {
      let query = supabase
        .from("notifications")
        .update({ displayed: true })
        .eq("user_id", userId)
        .eq("type", type);

      if (dedupeKey) query = query.eq("dedupe_key", dedupeKey);

      await query;
    } catch {
      safeConsole.error("Notification display update failed");
    }
  },

  async checkUsernameSetting(userId: string) {
    const supabase = createClient();
    const dedupeKey = "account:set-custom-username";

    try {
      // Verify user is still authenticated
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user || user.id !== userId) {
        safeConsole.error("Notification username authentication unavailable");
        return;
      }

      // Check if user has a custom username set
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();

      if (error) {
        throw error;
      }

      // Only proceed if username is default or not set
      if (!profile?.username || profile.username.startsWith("user_")) {
        // Check for existing notification
        const { data: existingNotifications, error: notifError } =
          await supabase
            .from("notifications")
            .select("id, displayed")
            .eq("user_id", userId)
            .eq("dedupe_key", dedupeKey)
            .limit(1);

        if (notifError) {
          safeConsole.error(
            "Notification username existing notice lookup failed",
          );
          return;
        }

        if (existingNotifications?.length) {
          // Notification exists - only show toast if not displayed before
          const notification = existingNotifications[0];
          if (!notification.displayed) {
            toast.info("Set Your Custom Username", {
              description:
                "Personalize your profile by setting a custom username in your account settings.",
              action: {
                label: "Go to settings",
                // This service is framework-agnostic and cannot use the Next.js navigation hook.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                onClick: () => (window.location.href = "/account/profile"),
              },
            });

            // Mark as displayed
            await this.markAsDisplayed(userId, "general", dedupeKey);
          }
        } else {
          // No notification exists, create one with toast
          await this.createNotification(
            {
              title: "Set Your Custom Username",
              body: "Personalize your profile by setting a custom username in your account settings.",
              type: "general",
              severity: "info",
              actionUrl: "/account/profile",
              dedupeKey,
            },
            userId,
            true,
          );
        }
      }
    } catch {
      safeConsole.error("Notification username check failed");
    }
  },
};
