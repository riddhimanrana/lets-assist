import * as React from "react";

import DataExportReadyEmail from "@/emails/data-export-ready";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { sendEmail } from "@/services/email";

import { getAdminClient } from "./admin";
import { createUserDataExportArchive } from "./user-data-export";

const EXPORT_BUCKET = "data-exports";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024; // 8MB

type ExportJobStatus = "pending" | "processing" | "completed" | "failed";

type ExportJobRecord = {
  id: string;
  user_id: string;
  requested_by: string | null;
  status: ExportJobStatus;
  delivery_email: string;
  attempt_count: number;
  request_metadata: Record<string, unknown> | null;
};

function getSignedUrlTTLSeconds(): number {
  const raw = process.env.DATA_EXPORT_SIGNED_URL_TTL_SECONDS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SIGNED_URL_TTL_SECONDS;
}

function getAttachmentMaxBytes(): number {
  const raw = process.env.DATA_EXPORT_ATTACHMENT_MAX_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ATTACHMENT_MAX_BYTES;
}

async function ensureExportBucket() {
  const supabase = getAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Unable to list storage buckets: ${listError.message}`);
  }

  const exists = (buckets ?? []).some((bucket) => bucket.name === EXPORT_BUCKET);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(EXPORT_BUCKET, {
    public: false,
    fileSizeLimit: "100MB",
  });

  if (createError) {
    throw new Error(`Unable to create storage bucket '${EXPORT_BUCKET}': ${createError.message}`);
  }
}

async function writeAuditEvent(params: {
  jobId: string | null;
  userId: string | null;
  eventType: string;
  status: "info" | "error";
  source: string;
  details?: Record<string, unknown>;
}) {
  const supabase = getAdminClient();

  const { error } = await supabase.from("account_data_export_audit_logs").insert({
    job_id: params.jobId,
    user_id: params.userId,
    event_type: params.eventType,
    status: params.status,
    source: params.source,
    details: params.details ?? {},
  });

  if (error) {
    logWarn("Failed to write data export audit event", {
      event_type: params.eventType,
      job_id: params.jobId ?? undefined,
      user_id: params.userId ?? undefined,
      error_message: error.message,
    });
  }
}

async function completeJob(jobId: string, updates: Record<string, unknown>) {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("account_data_export_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update export job ${jobId}: ${error.message}`);
  }
}

async function claimPendingJob(job: ExportJobRecord): Promise<ExportJobRecord | null> {
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("account_data_export_jobs")
    .update({
      status: "processing",
      started_at: now,
      attempt_count: (job.attempt_count ?? 0) + 1,
      last_attempt_at: now,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id, user_id, requested_by, status, delivery_email, attempt_count, request_metadata")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim export job ${job.id}: ${error.message}`);
  }

  return (data as ExportJobRecord | null) ?? null;
}

async function processSingleJob(job: ExportJobRecord) {
  const supabase = getAdminClient();
  const signedUrlTtl = getSignedUrlTTLSeconds();
  const attachmentMaxBytes = getAttachmentMaxBytes();

  await writeAuditEvent({
    jobId: job.id,
    userId: job.user_id,
    eventType: "processing_started",
    status: "info",
    source: "cron-worker",
  });

  const archive = await createUserDataExportArchive(job.user_id, {
    sanitizeSensitive: true,
  });

  const storagePath = `${job.user_id}/${job.id}/${archive.fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(storagePath, archive.zipBuffer, {
      contentType: "application/zip",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(`Failed to upload data export ZIP: ${uploadError.message}`);
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(storagePath, signedUrlTtl);

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedError?.message || "Unknown error"}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const accountUrl = `${siteUrl.replace(/\/$/, "")}/account/security`;
  const userName =
    (job.request_metadata?.full_name as string | undefined) ||
    (job.request_metadata?.name as string | undefined) ||
    "there";

  const shouldAttach = archive.zipBuffer.length <= attachmentMaxBytes;
  const attachmentContent = shouldAttach
    ? archive.zipBuffer.toString("base64")
    : undefined;

  const expiresAt = new Date(Date.now() + signedUrlTtl * 1000).toISOString();

  const emailResponse = await sendEmail({
    to: job.delivery_email,
    subject: "Your Let’s Assist data export is ready",
    react: React.createElement(DataExportReadyEmail, {
      userName,
      generatedAt: archive.payload.metadata.generatedAt,
      recordsExported: archive.payload.metadata.totalRecords,
      attachmentName: archive.fileName,
      accountUrl,
      downloadUrl: signedData.signedUrl,
      linkExpiresAt: expiresAt,
      deliveryMode: shouldAttach ? "attachment_and_link" : "link_only",
      zipSizeBytes: archive.zipBuffer.length,
    }),
    type: "transactional",
    attachments: shouldAttach
      ? [
          {
            filename: archive.fileName,
            content: attachmentContent!,
          },
        ]
      : undefined,
  });

  if (!emailResponse.success) {
    const errorMessage =
      "error" in emailResponse && emailResponse.error
        ? typeof emailResponse.error === "string"
          ? emailResponse.error
          : (emailResponse.error as { message?: string }).message || "Email send failed"
        : "Email send failed";

    throw new Error(errorMessage);
  }

  await completeJob(job.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    storage_path: storagePath,
    signed_url: signedData.signedUrl,
    signed_url_expires_at: expiresAt,
    zip_size_bytes: archive.zipBuffer.length,
    record_count: archive.payload.metadata.totalRecords,
    datasets_count: archive.payload.metadata.totalDatasets,
    export_metadata: {
      manifest: archive.manifest,
      deliveryMode: shouldAttach ? "attachment_and_link" : "link_only",
    },
    error_message: null,
  });

  await writeAuditEvent({
    jobId: job.id,
    userId: job.user_id,
    eventType: "processing_completed",
    status: "info",
    source: "cron-worker",
    details: {
      delivery_mode: shouldAttach ? "attachment_and_link" : "link_only",
      zip_size_bytes: archive.zipBuffer.length,
      record_count: archive.payload.metadata.totalRecords,
    },
  });

  logInfo("Data export job completed", {
    job_id: job.id,
    user_id: job.user_id,
    zip_size_bytes: archive.zipBuffer.length,
    record_count: archive.payload.metadata.totalRecords,
  });
}

export async function processPendingDataExportJobs(limit = 5) {
  const supabase = getAdminClient();
  await ensureExportBucket();

  const { data: pendingJobs, error: pendingError } = await supabase
    .from("account_data_export_jobs")
    .select("id, user_id, requested_by, status, delivery_email, attempt_count, request_metadata")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(limit);

  if (pendingError) {
    throw new Error(`Failed to fetch pending export jobs: ${pendingError.message}`);
  }

  const jobs = (pendingJobs as ExportJobRecord[] | null) ?? [];
  if (jobs.length === 0) {
    return { processed: 0, completed: 0, failed: 0, skipped: 0 };
  }

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const pendingJob of jobs) {
    let claimed: ExportJobRecord | null = null;

    try {
      claimed = await claimPendingJob(pendingJob);
      if (!claimed) {
        skipped += 1;
        continue;
      }

      await processSingleJob(claimed);
      completed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown export processing error";

      logError("Data export job failed", error, {
        job_id: pendingJob.id,
        user_id: pendingJob.user_id,
      });

      await completeJob(pendingJob.id, {
        status: "failed",
        failed_at: new Date().toISOString(),
        error_message: message,
      }).catch((completeError) => {
        logError("Failed to mark export job as failed", completeError, {
          job_id: pendingJob.id,
        });
      });

      await writeAuditEvent({
        jobId: pendingJob.id,
        userId: pendingJob.user_id,
        eventType: "processing_failed",
        status: "error",
        source: "cron-worker",
        details: { error: message },
      });
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
    skipped,
  };
}