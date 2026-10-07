import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

import { ACCOUNT_EXPORT_MAX_ZIP_BYTES } from "../../lib/supabase/data-export-limits";

import { getCsfIsolatedSupabaseEnv } from "./dv-local-env.mjs";

type Subject = { id: string; email?: string; email_confirmed_at?: string };
type PendingJob = {
  id: string;
  user_id: string;
  status: string;
  protocol_version: number;
};
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

export function assertExportRehearsalSubject(
  userId: string,
  jobId: string,
  user: Subject,
  job: PendingJob,
  queue: Array<{ id: string }>,
) {
  if (
    !new RegExp(`^${UUID}$`, "u").test(userId) ||
    !new RegExp(`^${UUID}$`, "u").test(jobId)
  )
    throw new Error("Export rehearsal identifiers are invalid.");
  if (
    user.id !== userId ||
    !user.email_confirmed_at ||
    !new RegExp(`^export\\.worker\\.${UUID}@local\\.test$`, "u").test(
      user.email ?? "",
    )
  )
    throw new Error(
      "Export rehearsal requires its verified fictional account.",
    );
  if (
    job.id !== jobId ||
    job.user_id !== userId ||
    job.status !== "pending" ||
    job.protocol_version !== 2
  )
    throw new Error(
      "Export rehearsal requires the owned pending protocol-2 job.",
    );
  if (queue.length !== 1 || queue[0].id !== jobId)
    throw new Error("Export rehearsal refuses another active export job.");
}

async function main() {
  const [userId, jobId, ...extra] = process.argv.slice(2);
  if (!userId || !jobId || extra.length)
    throw new Error("Supply the fictional user and export job UUIDs.");
  const local = getCsfIsolatedSupabaseEnv();
  const ledger = process.env.CRON_EGRESS_LEDGER;
  if (!ledger)
    throw new Error("Export rehearsal requires an owned egress ledger.");
  const posture = lstatSync(ledger);
  if (
    !posture.isFile() ||
    posture.isSymbolicLink() ||
    (posture.mode & 0o777) !== 0o600 ||
    posture.size !== 0 ||
    (typeof process.getuid === "function" && posture.uid !== process.getuid())
  )
    throw new Error("Export rehearsal requires an empty owner-only ledger.");
  process.env.CRON_EGRESS_ALLOWED_LOOPBACK_PORTS = new URL(local.url).port;
  process.env.CRON_EGRESS_ALLOWED_SMTP_PORTS = "";
  process.env.CRON_EGRESS_SMTP_PORTS = "";
  createRequire(import.meta.url)("./cron-egress-guard.cjs");
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [userResult, jobResult, queueResult, bucket] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("account_data_export_jobs")
      .select("id,user_id,status,protocol_version")
      .eq("id", jobId)
      .single(),
    admin
      .from("account_data_export_jobs")
      .select("id")
      .or(
        "status.in.(pending,processing),and(status.eq.completed,delivery_status.eq.not_attempted)",
      )
      .limit(2),
    admin.storage.getBucket("data-exports"),
  ]);
  if (
    userResult.error ||
    jobResult.error ||
    queueResult.error ||
    bucket.error ||
    !userResult.data.user ||
    !jobResult.data ||
    !queueResult.data ||
    !bucket.data ||
    bucket.data.public
  )
    throw new Error("Export rehearsal prerequisites could not be confirmed.");
  assertExportRehearsalSubject(
    userId,
    jobId,
    userResult.data.user,
    jobResult.data,
    queueResult.data,
  );
  const claimed = await admin.rpc("claim_account_data_export_jobs", {
    p_limit: 1,
  });
  if (
    claimed.error ||
    claimed.data?.length !== 1 ||
    claimed.data[0].id !== jobId ||
    claimed.data[0].user_id !== userId
  )
    throw new Error("Export rehearsal claim did not match its owned request.");
  const { processClaimedDataExport } =
    await import("../../lib/supabase/data-export-jobs");
  const { ACCOUNT_EXPORT_DATASET_NAMES } =
    await import("../../lib/supabase/user-data-export");
  let mailAttempts = 0;
  const result = await processClaimedDataExport(claimed.data[0], {
    client: admin,
    send: async (message) => {
      mailAttempts += 1;
      if (
        message.to !== userResult.data.user.email ||
        message.idempotencyKey !== `account-export/${jobId}/ready-v2`
      )
        throw new Error("Export rehearsal mail subject mismatch.");
      return {
        outcome: "skipped",
        success: false,
        skipped: true,
        phase: "transport_setup",
        code: "local_rehearsal",
        reason: "Local rehearsal does not send mail.",
      };
    },
  });
  if (!result.ready || result.delivery !== "skipped" || mailAttempts !== 1)
    throw new Error("Export rehearsal did not complete with mail skipped.");
  const saved = await admin
    .from("account_data_export_jobs")
    .select(
      "status,delivery_status,storage_path,artifact_sha256,zip_size_bytes,record_count,datasets_count",
    )
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  if (
    saved.error ||
    !saved.data ||
    saved.data.status !== "completed" ||
    saved.data.delivery_status !== "skipped" ||
    !new RegExp(`^${userId}/${jobId}/${UUID}\\.zip$`, "u").test(
      saved.data.storage_path ?? "",
    )
  )
    throw new Error("Export rehearsal completion receipt is invalid.");
  const download = await admin.storage
    .from("data-exports")
    .download(saved.data.storage_path);
  if (
    download.error ||
    !download.data ||
    download.data.size !== saved.data.zip_size_bytes ||
    download.data.size > ACCOUNT_EXPORT_MAX_ZIP_BYTES
  )
    throw new Error("Export rehearsal private object readback failed.");
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    saved.data.artifact_sha256
  )
    throw new Error("Export rehearsal private object digest differs.");
  const archive = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(
    await archive.file("manifest.json")!.async("string"),
  );
  const counts = JSON.parse(
    await archive.file("counts.json")!.async("string"),
  ) as Record<string, number>;
  if (
    manifest.userId !== userId ||
    manifest.totalDatasets !== 48 ||
    saved.data.datasets_count !== 48 ||
    JSON.stringify(Object.keys(counts).sort()) !==
      JSON.stringify([...ACCOUNT_EXPORT_DATASET_NAMES].sort()) ||
    Object.values(counts).reduce((sum, value) => sum + value, 0) !==
      saved.data.record_count
  )
    throw new Error("Export rehearsal dataset inventory differs.");
  for (const category of manifest.categories) {
    for (const file of category.files) {
      const value = JSON.parse(
        await archive.file(`${category.folder}/${file}`)!.async("string"),
      );
      if (
        category.folder !== "auth" &&
        (!Array.isArray(value) ||
          value.length !== counts[file.replace(/\.json$/u, "")])
      )
        throw new Error("Export rehearsal dataset row count differs.");
    }
  }
  if (readFileSync(ledger, "utf8") !== "")
    throw new Error("Export rehearsal attempted refused egress.");
  process.stdout.write(
    JSON.stringify({
      ready: true,
      delivery: "skipped",
      mailAttempts,
      datasets: 48,
      records: saved.data.record_count,
      bytes: bytes.length,
    }) + "\n",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "Local account export rehearsal failed. Inspect the retained local job and egress receipt.\n",
    );
    process.exitCode = 1;
  });
}
