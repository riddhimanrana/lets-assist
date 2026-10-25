import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logWarn } from "@/lib/logger";
import { sendEmail, type SendEmailResult } from "@/services/email";
import { getAdminClient } from "./admin";
import { createUserDataExportArchive } from "./user-data-export";
import { ACCOUNT_EXPORT_MAX_ZIP_BYTES } from "./data-export-limits";

const BUCKET = "data-exports";
const jobSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  lease_token: z.string().uuid(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  storage_path: z.string().nullable(),
  artifact_sha256: z.string().nullable(),
  zip_size_bytes: z.number().nullable(),
  artifact_ready_at: z.string().nullable(),
  artifact_expires_at: z.string().nullable(),
  delivery_status: z.enum([
    "not_attempted",
    "sending",
    "accepted",
    "skipped",
    "failed",
  ]),
  delivery_email: z.string().email(),
  export_metadata: z.record(z.string(), z.unknown()),
});
export type DataExportWorkerJob = z.infer<typeof jobSchema>;
type Archive = Awaited<ReturnType<typeof createUserDataExportArchive>>;
type Dependencies = {
  client?: SupabaseClient;
  archive?: (userId: string) => Promise<Archive>;
  send?: typeof sendEmail;
};
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const ownedPath = (job: DataExportWorkerJob, path: string) =>
  new RegExp(`^${job.user_id}/${job.id}/[a-f0-9-]{36}\\.zip$`).test(path);

async function advance(
  client: SupabaseClient,
  job: DataExportWorkerJob,
  step: string,
  data: Record<string, unknown> = {},
) {
  const result = await client.rpc("advance_account_data_export", {
    p_job_id: job.id,
    p_lease: job.lease_token,
    p_step: step,
    p_data: data,
  });
  if (result.error || !result.data)
    throw new Error("Account export transition unconfirmed");
  // Settlement clears the claim, so its acknowledgment is checked separately.
  if (step === "settle_delivery" || step === "failed") {
    if (result.data.id !== job.id || result.data.user_id !== job.user_id)
      throw new Error("Account export receipt mismatch");
    return job;
  }
  const next = jobSchema.parse(result.data);
  if (
    next.id !== job.id ||
    next.user_id !== job.user_id ||
    next.lease_token !== job.lease_token
  ) {
    throw new Error("Account export receipt mismatch");
  }
  return next;
}

async function verifyStoredArchive(
  client: SupabaseClient,
  job: DataExportWorkerJob,
): Promise<boolean> {
  if (
    !job.storage_path ||
    !ownedPath(job, job.storage_path) ||
    !job.artifact_sha256 ||
    !job.zip_size_bytes
  ) {
    throw new Error("Account export artifact identity missing");
  }
  const result = await client.storage.from(BUCKET).download(job.storage_path);
  if (result.error) {
    const status = String(
      (result.error as { statusCode?: unknown }).statusCode,
    );
    if (status === "404") return false;
    throw new Error("Account export object read unconfirmed");
  }
  if (
    !result.data ||
    result.data.size !== job.zip_size_bytes ||
    result.data.size > ACCOUNT_EXPORT_MAX_ZIP_BYTES
  ) {
    throw new Error("Account export object size mismatch");
  }
  if (
    hash(Buffer.from(await result.data.arrayBuffer())) !== job.artifact_sha256
  ) {
    throw new Error("Account export object digest mismatch");
  }
  return true;
}

export async function processClaimedDataExport(
  jobInput: DataExportWorkerJob,
  dependencies: Dependencies = {},
) {
  const client = dependencies.client ?? getAdminClient({ timeoutMs: 30_000 });
  const archiveFactory = dependencies.archive ?? createUserDataExportArchive;
  const dispatch = dependencies.send ?? sendEmail;
  let job = jobSchema.parse(jobInput);
  try {
    if (!job.artifact_ready_at) {
      const recovered = job.storage_path
        ? await verifyStoredArchive(client, job)
        : false;
      if (!recovered) {
        const archive = await archiveFactory(job.user_id);
        job = await advance(client, job, "plan_artifact", {
          sha256: hash(archive.zipBuffer),
          size_bytes: archive.zipBuffer.length,
          record_count: archive.payload.metadata.totalRecords,
          datasets_count: archive.payload.metadata.totalDatasets,
          manifest: archive.manifest,
        });
        if (!job.storage_path || !ownedPath(job, job.storage_path))
          throw new Error("Account export upload path refused");
        const { error } = await client.storage
          .from(BUCKET)
          .upload(job.storage_path, archive.zipBuffer, {
            contentType: "application/zip",
            upsert: false,
            cacheControl: "0",
          });
        if (error) throw new Error("Account export upload unconfirmed");
        if (!(await verifyStoredArchive(client, job)))
          throw new Error("Account export upload missing");
      }
      job = await advance(client, job, "archive_ready");
    }
    if (job.delivery_status !== "not_attempted")
      return { ready: true, delivery: job.delivery_status };
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (
      origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    ) {
      throw new Error("Account export notification origin refused");
    }
    job = await advance(client, job, "begin_delivery");
    let outcome: SendEmailResult | undefined;
    try {
      outcome = await dispatch({
        to: job.delivery_email,
        type: "transactional",
        subject: "Your Let's Assist data export is ready",
        text: `Your account export is ready. Sign in to download it from ${origin.origin}/account/security. The archive is available until ${job.artifact_expires_at}.`,
        idempotencyKey: `account-export/${job.id}/ready-v2`,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      /* A thrown provider call leaves an unknown delivery receipt. */
    }
    const delivery =
      outcome?.outcome === "accepted"
        ? "accepted"
        : outcome?.outcome === "skipped"
          ? "skipped"
          : outcome?.outcome === "definitive_failure" ||
              outcome?.outcome === "retryable_pre_send"
            ? "failed"
            : "unknown";
    await advance(client, job, "settle_delivery", {
      outcome: delivery,
      ...(outcome?.outcome === "accepted"
        ? { message_id: outcome.messageId }
        : {}),
    });
    return { ready: true, delivery };
  } catch (error) {
    // The database refuses this transition after archive_ready, during delivery,
    // or after another worker owns the job. Never overwrite newer progress.
    await advance(client, job, "failed").catch(() => undefined);
    logError("Data export job failed", error, { job_id: job.id });
    return { ready: Boolean(job.artifact_ready_at), delivery: "unconfirmed" };
  }
}

async function cleanupExpiredArtifacts(client: SupabaseClient) {
  const { data, error } = await client.rpc("expired_account_export_artifacts", {
    p_limit: 10,
  });
  if (error || !Array.isArray(data))
    throw new Error("Account export cleanup inventory unavailable");
  let removed = 0;
  let failed = 0;
  for (const row of data) {
    const path = row.storage_path;
    if (
      typeof path !== "string" ||
      !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.zip$/.test(path)
    ) {
      throw new Error("Account export cleanup path refused");
    }
    const result = await client.storage.from(BUCKET).remove([path]);
    if (result.error) {
      failed++;
      continue;
    }
    const confirmed = await client.rpc(
      "confirm_account_export_artifact_removed",
      { p_path: path },
    );
    if (!confirmed.error && confirmed.data === true) removed++;
    else failed++;
  }
  return { removed, failed };
}

export async function processPendingDataExportJobs(
  limit = 1,
  dependencies: Dependencies = {},
) {
  const client = dependencies.client ?? getAdminClient({ timeoutMs: 30_000 });
  const boundedLimit = Math.min(
    5,
    Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1)),
  );
  const bucket = await client.storage.getBucket(BUCKET);
  if (bucket.error || !bucket.data || bucket.data.public)
    throw new Error("Private export bucket unavailable");
  let removed = 0;
  let cleanupFailed = false;
  try {
    const cleanup = await cleanupExpiredArtifacts(client);
    removed = cleanup.removed;
    cleanupFailed = cleanup.failed > 0;
  } catch {
    cleanupFailed = true;
    logWarn("Data export artifact cleanup unconfirmed");
  }
  let processed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < boundedLimit; i++) {
    // Claim only when ready to process. A batch's last job must not wait out its lease.
    const claim = await client.rpc("claim_account_data_export_jobs", {
      p_limit: 1,
    });
    if (claim.error || !Array.isArray(claim.data))
      throw new Error("Account export claim unavailable");
    if (claim.data.length === 0) break;
    if (claim.data.length !== 1)
      throw new Error("Account export claim count mismatch");
    const result = await processClaimedDataExport(
      jobSchema.parse(claim.data[0]),
      { ...dependencies, client },
    );
    processed++;
    if (result.ready) completed++;
    else failed++;
    if (result.delivery !== "accepted") skipped++;
  }
  return { processed, completed, failed, skipped, removed, cleanupFailed };
}
