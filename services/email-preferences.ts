import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type { EmailType } from "./email";

export type RecipientEmailPolicy =
  { allowed: true } | { allowed: false; retryable: boolean; code: string };

/** Query only consent fields, independently of the sender's cookie/session. */
export async function getRecipientEmailPolicy(
  userId: string,
  type: Exclude<EmailType, "transactional">,
): Promise<RecipientEmailPolicy> {
  try {
    const { data, error } = await getAdminClient()
      .from("notification_settings")
      .select("email_notifications, project_updates, general")
      .eq("user_id", userId)
      .maybeSingle();
    if (error)
      return {
        allowed: false,
        retryable: true,
        code: "preferences_unavailable",
      };
    // No row means the account still uses the documented enabled defaults.
    if (!data) return { allowed: true };
    if (data.email_notifications === false) {
      return {
        allowed: false,
        retryable: false,
        code: "global_email_disabled",
      };
    }
    if (type === "project_updates" && data.project_updates === false) {
      return {
        allowed: false,
        retryable: false,
        code: "project_updates_disabled",
      };
    }
    if (type === "general" && data.general === false) {
      return {
        allowed: false,
        retryable: false,
        code: "general_notifications_disabled",
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, retryable: true, code: "preferences_unavailable" };
  }
}
