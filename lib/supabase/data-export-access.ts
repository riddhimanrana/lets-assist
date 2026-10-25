import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const EXPORT_HISTORY_COLUMNS =
  "id,status,delivery_email,requested_at,completed_at,artifact_expires_at,zip_size_bytes,record_count,delivery_status,protocol_version,error_message";
const uuid = z.string().uuid();
const jobDto = z.object({
  id: uuid,
  status: z.enum(["pending", "processing", "completed", "failed"]),
  delivery_email: z.string().email(),
  requested_at: z.string(),
  completed_at: z.string().nullable(),
  artifact_expires_at: z.string().nullable(),
  zip_size_bytes: z.number().nullable(),
  record_count: z.number(),
  delivery_status: z.enum([
    "not_attempted",
    "sending",
    "accepted",
    "skipped",
    "failed",
  ]),
  protocol_version: z.number().int(),
  error_message: z.unknown(),
});
export type AccountExportJob = Omit<z.infer<typeof jobDto>, "error_message"> & {
  error_message: string | null;
};
export function accountExportJobDto(value: unknown): AccountExportJob {
  const job = jobDto.parse(value);
  return {
    ...job,
    error_message:
      job.status === "failed"
        ? "Archive generation could not be confirmed."
        : null,
  };
}

export async function createAccountExportDownload(
  client: SupabaseClient,
  userId: string,
  jobId: string,
  now = Date.now(),
) {
  uuid.parse(userId);
  uuid.parse(jobId);
  const { data, error } = await client
    .from("account_data_export_jobs")
    .select(
      "id,user_id,status,protocol_version,storage_path,artifact_ready_at,artifact_expires_at",
    )
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.id !== jobId ||
    data.user_id !== userId ||
    data.status !== "completed" ||
    data.protocol_version !== 2 ||
    !data.artifact_ready_at ||
    typeof data.storage_path !== "string" ||
    !new RegExp(`^${userId}/${jobId}/[a-f0-9-]{36}\\.zip$`).test(
      data.storage_path,
    ) ||
    !data.artifact_expires_at ||
    !Number.isFinite(Date.parse(data.artifact_expires_at)) ||
    Date.parse(data.artifact_expires_at) <= now
  ) {
    throw new Error("This export is unavailable or has expired.");
  }
  const ttl = Math.min(
    300,
    Math.floor((Date.parse(data.artifact_expires_at) - now) / 1000),
  );
  if (ttl < 1) throw new Error("This export has expired.");
  const signed = await client.storage
    .from("data-exports")
    .createSignedUrl(data.storage_path, ttl, {
      download: "lets-assist-account-data.zip",
    });
  if (signed.error || !signed.data?.signedUrl)
    throw new Error("The export download could not be prepared.");
  return signed.data.signedUrl;
}
