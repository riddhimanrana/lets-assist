"use server";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  accountExportJobDto,
  createAccountExportDownload,
  EXPORT_HISTORY_COLUMNS,
} from "@/lib/supabase/data-export-access";

export async function requestDataExport() {
  const { user, error } = await getAuthUser({
    sensitive: true,
    checkMfa: true,
  });
  if (error || !user)
    return {
      success: false as const,
      error: "Sign in again to request an export.",
    };
  try {
    const client = getAdminClient({ timeoutMs: 30_000 });
    const request = await client.rpc("request_account_data_export", {
      p_user_id: user.id,
    });
    if (
      request.error ||
      !request.data?.id ||
      typeof request.data.existing !== "boolean"
    ) {
      throw new Error("request unavailable");
    }
    const result = await client
      .from("account_data_export_jobs")
      .select(EXPORT_HISTORY_COLUMNS)
      .eq("id", request.data.id)
      .eq("user_id", user.id)
      .single();
    if (result.error) throw new Error("request readback unavailable");
    const job = accountExportJobDto(result.data);
    return {
      success: true as const,
      job,
      existing: request.data.existing as boolean,
      queued: job.status === "pending" || job.status === "processing",
      email: job.delivery_email,
      jobId: job.id,
      requestedAt: job.requested_at,
    };
  } catch {
    return {
      success: false as const,
      error:
        "Your export request could not be confirmed. Refresh the request history before retrying.",
    };
  }
}

export async function readDataExportJobs() {
  const { user, error } = await getAuthUser({ sensitive: false });
  if (error || !user)
    return { success: false as const, error: "Not authenticated", jobs: [] };
  try {
    const result = await getAdminClient({ timeoutMs: 15_000 })
      .from("account_data_export_jobs")
      .select(EXPORT_HISTORY_COLUMNS)
      .eq("user_id", user.id)
      .order("requested_at", { ascending: false })
      .limit(5);
    if (result.error) throw new Error("history unavailable");
    return {
      success: true as const,
      jobs: (result.data ?? []).map(accountExportJobDto),
    };
  } catch {
    return {
      success: false as const,
      error: "Export history is temporarily unavailable.",
      jobs: [],
    };
  }
}

export async function downloadDataExport(jobId: string) {
  const { user, error } = await getAuthUser({
    sensitive: true,
    checkMfa: true,
  });
  if (error || !user)
    return {
      success: false as const,
      error: "Sign in again to download your export.",
    };
  try {
    const url = await createAccountExportDownload(
      getAdminClient({ timeoutMs: 15_000 }),
      user.id,
      jobId,
    );
    return { success: true as const, url };
  } catch {
    return {
      success: false as const,
      error:
        "This export is unavailable, has expired, or could not be verified.",
    };
  }
}
