import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type { NotificationData } from "@/services/notification-types";

export type {
  NotificationData,
  NotificationSeverity,
  NotificationType,
} from "@/services/notification-types";

interface NotificationPreferences {
  email_notifications: boolean;
  project_updates: boolean;
  general?: boolean;
  [key: string]: boolean | undefined;
}

export type CreateNotificationResult =
  { success: true } | { success: false; skipped: true } | { error: unknown };

/**
 * Deliver a notification from a server context.
 *
 * Server modules must not reach the database through the browser Supabase
 * client: on the server it carries no session, so `auth.uid()` is NULL and the
 * insert only ever succeeded because the notifications INSERT policy ended in
 * `OR (auth.uid() IS NULL)` — a clause that also let any unauthenticated caller
 * holding the public anon key write a notification for any user. Writing with
 * the service-role client removes that dependency so the policy can be closed.
 *
 * Unlike the browser service, this does not suppress a notification because one
 * of the same `type` already exists. That check has no other filter, so it
 * silently swallowed every repeat: a volunteer rejected twice was told once.
 * Server-side delivery is per event; one-time nudges belong to the caller.
 */
export async function createNotificationForUser(
  notification: NotificationData,
  userId: string,
): Promise<CreateNotificationResult> {
  const supabase = getAdminClient();
  const severity = notification.severity ?? "info";

  try {
    const { data: preferences, error: preferencesError } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("user_id", userId)
      .single<NotificationPreferences>();

    // PGRST116 is "no rows returned": a user with no settings row has opted out
    // of nothing, so delivery continues.
    if (preferencesError && preferencesError.code !== "PGRST116") {
      console.error(
        "Error fetching notification settings:",
        preferencesError.message,
      );
      return { error: preferencesError };
    }

    if (preferences?.[notification.type] === false) {
      return { success: false, skipped: true };
    }

    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: userId,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      severity,
      action_url: notification.actionUrl,
      data: notification.data,
      displayed: false,
      read: false,
    });

    if (insertError) {
      console.error(
        "Notification insert failed:",
        insertError.message,
        insertError.code,
      );
      return { error: insertError };
    }

    return { success: true };
  } catch (error) {
    console.error("Error creating notification:", error);
    return { error };
  }
}
