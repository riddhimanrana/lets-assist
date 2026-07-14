import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

export type PrimaryEmailSyncResult = {
  success: boolean;
  status: "synced" | "conflict" | "no_primary_email" | "error";
  primaryEmail?: string;
};

export async function syncPrimaryUserEmail(
  userId: string,
): Promise<PrimaryEmailSyncResult> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("sync_primary_user_email", {
    p_user_id: userId,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status?: string; primary_email?: string | null }
    | null;

  if (error || !row) {
    if (error) console.error("Primary email synchronization failed:", error);
    return { success: false, status: "error" };
  }

  if (row.status === "synced") {
    return {
      success: true,
      status: "synced",
      primaryEmail: row.primary_email ?? undefined,
    };
  }

  if (row.status === "conflict" || row.status === "no_primary_email") {
    return {
      success: false,
      status: row.status,
      primaryEmail: row.primary_email ?? undefined,
    };
  }

  return { success: false, status: "error" };
}
