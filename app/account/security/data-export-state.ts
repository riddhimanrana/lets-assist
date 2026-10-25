import { z } from "zod";

export const exportJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "processing", "completed", "failed", "legacy"]),
  delivery_email: z.string(),
  requested_at: z.string(),
  completed_at: z.string().nullable(),
  artifact_expires_at: z.string().nullable(),
  zip_size_bytes: z.number().nonnegative().nullable(),
  record_count: z.number().int().nonnegative().nullable(),
  delivery_status: z.enum([
    "not_attempted",
    "sending",
    "accepted",
    "skipped",
    "failed",
  ]),
  protocol_version: z.number().int().positive(),
  error_message: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export function exportJobPresentation(job: ExportJob, now = Date.now()) {
  const legacy = job.protocol_version !== 2 || job.status === "legacy";
  const expiry = job.artifact_expires_at
    ? Date.parse(job.artifact_expires_at)
    : Number.NaN;
  const ready =
    !legacy &&
    job.status === "completed" &&
    Number.isFinite(expiry) &&
    expiry > now;
  const active =
    !legacy && (job.status === "pending" || job.status === "processing");
  const expired =
    job.status === "completed" && Number.isFinite(expiry) && expiry <= now;
  const label = legacy
    ? "Needs review"
    : job.status === "pending"
      ? "Queued"
      : job.status === "processing"
        ? "Preparing"
        : job.status === "failed"
          ? "Failed"
          : ready
            ? "Ready"
            : expired
              ? "Expired"
              : "Download unavailable";
  const description = legacy
    ? "This request needs review. Its archive and email status cannot be confirmed."
    : job.status === "failed"
      ? job.error_message ||
        "The archive could not be prepared. Try again when a new request is available."
      : expired
        ? "This archive has expired. Request another export when available."
        : job.status === "completed" && !ready
          ? "Download availability could not be confirmed. Refresh the request status."
          : job.status === "pending"
            ? "Your request is waiting to be processed."
            : job.status === "processing"
              ? "Your archive is being prepared. You can return to this page later."
              : "Your archive is ready to download.";
  const emailLabel = legacy
    ? "Email status unknown"
    : job.delivery_status === "accepted"
      ? "Email accepted for delivery"
      : job.delivery_status === "sending"
        ? "Email unconfirmed"
        : job.delivery_status === "failed"
          ? "Email failed"
          : job.delivery_status === "skipped"
            ? "Email skipped"
            : "Email not attempted";
  const emailWarning = legacy
    ? null
    : job.delivery_status === "sending"
      ? "The email request may have been accepted, but confirmation is missing. Check the archive status here."
      : job.delivery_status === "failed" || job.delivery_status === "skipped"
        ? "The email notice is unavailable. A ready archive can still be downloaded here."
        : null;
  return {
    label,
    description,
    emailLabel,
    emailWarning,
    canDownload: ready,
    active,
    shouldPoll: active || (ready && job.delivery_status === "not_attempted"),
  };
}

export function mergeExportJob(jobs: ExportJob[], job: ExportJob) {
  return [job, ...jobs.filter((previous) => previous.id !== job.id)]
    .sort(
      (left, right) =>
        Date.parse(right.requested_at) - Date.parse(left.requested_at),
    )
    .slice(0, 5);
}

export function exportRequestMessage(existing: boolean) {
  return existing
    ? "Showing your existing export request. Requests are limited to one every 24 hours."
    : "Your export request has been recorded. Check its status here while the archive is prepared.";
}

export function validExportDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
