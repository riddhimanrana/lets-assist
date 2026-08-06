import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { checkSuperAdmin } from "./auth";
import { createServerNotification, type NotificationSeverity } from "./shared";

export async function sendSystemNotification(
  prevState: { error?: string; success?: boolean; message?: string } | null,
  formData: FormData,
) {
  "use server";
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
      const { data: users, error } = await supabase
        .from("profiles")
        .select("id");

      if (error || !users)
        return { error: "Failed to fetch users for broadcast." };

      const notifications = users.map((u) => ({
        user_id: u.id,
        title,
        body,
        type: "admin_broadcast",
        severity,
        action_url: actionUrl || null,
        displayed: false,
        read: false,
      }));

      const { error: insertError } = await supabase
        .from("notifications")
        .insert(notifications);
      if (insertError) {
        console.error("Broadcast error:", insertError);
        return { error: "Failed to send broadcast." };
      }
    } else {
      // Single user
      await createServerNotification(
        targetUserId,
        title,
        body,
        severity,
        actionUrl || undefined,
      );
    }

    return { success: true, message: "Notification sent successfully." };
  } catch (err) {
    console.error("Error sending notification:", err);
    return { error: "Internal Server Error" };
  }
}
