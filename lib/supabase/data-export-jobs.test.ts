import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendEmailParams, SendEmailResult } from "@/services/email";
import {
  processClaimedDataExport,
  type DataExportWorkerJob,
} from "./data-export-jobs";
import type { createUserDataExportArchive } from "./user-data-export";
import { ACCOUNT_EXPORT_MAX_ZIP_BYTES } from "./data-export-limits";
const userId = "fa900000-0000-4000-8000-000000000001";
const jobId = "fa900000-0000-4000-8000-000000000002";
const lease = "fa900000-0000-4000-8000-000000000003";
const bytes = Buffer.from("synthetic archive");
const sha = createHash("sha256").update(bytes).digest("hex");
const accepted: SendEmailResult = {
  outcome: "accepted",
  success: true,
  skipped: false,
  phase: "provider_response",
  messageId: "synthetic",
  transport: "resend",
  data: { id: "synthetic" },
};
function fixture(
  options: {
    recover?: boolean;
    lost?: string;
    digestMismatch?: boolean;
    uploadUnknown?: boolean;
    skip?: boolean;
    sendThrows?: boolean;
    downloadSize?: number;
  } = {},
) {
  const events: string[] = [];
  let archiveCalls = 0;
  let mailCalls = 0;
  const row: DataExportWorkerJob = {
    id: jobId,
    user_id: userId,
    lease_token: lease,
    status: "processing",
    storage_path: null,
    artifact_sha256: null,
    zip_size_bytes: null,
    artifact_ready_at: null,
    artifact_expires_at: null,
    delivery_status: "not_attempted",
    delivery_email: "synthetic@example.test",
    export_metadata: {},
  };
  const objects = new Map<string, Buffer>();
  if (options.recover) {
    row.storage_path = `${userId}/${jobId}/${lease}.zip`;
    row.artifact_sha256 = sha;
    row.zip_size_bytes = bytes.length;
    objects.set(
      row.storage_path,
      options.digestMismatch ? Buffer.alloc(bytes.length) : bytes,
    );
  }
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const step = args.p_step as string;
      events.push(step);
      if (args.p_lease !== row.lease_token) return { data: null, error: {} };
      if (step === "plan_artifact") {
        const data = args.p_data as Record<string, unknown>;
        row.storage_path = `${userId}/${jobId}/${lease}.zip`;
        row.artifact_sha256 = data.sha256 as string;
        row.zip_size_bytes = data.size_bytes as number;
      } else if (step === "archive_ready") {
        row.status = "completed";
        row.artifact_ready_at = new Date().toISOString();
        row.artifact_expires_at = new Date(Date.now() + 86400000).toISOString();
      } else if (step === "begin_delivery") {
        if (row.delivery_status !== "not_attempted")
          return { data: null, error: {} };
        row.delivery_status = "sending";
      } else if (step === "settle_delivery") {
        const outcome = (args.p_data as Record<string, string>).outcome;
        row.delivery_status = (
          outcome === "unknown" ? "sending" : outcome
        ) as DataExportWorkerJob["delivery_status"];
      } else if (step === "failed") {
        if (row.status === "completed") return { data: null, error: {} };
        row.status = "pending";
      }
      return options.lost === step
        ? { data: null, error: {} }
        : { data: { ...row }, error: null };
    },
    storage: {
      from: () => ({
        upload: async (
          path: string,
          body: Buffer,
          opts: { upsert: boolean },
        ) => {
          events.push("upload");
          expect(opts.upsert).toBe(false);
          objects.set(path, body);
          return { error: options.uploadUnknown ? {} : null };
        },
        download: async (path: string) => {
          events.push("download");
          if (options.downloadSize !== undefined)
            return {
              data: {
                size: options.downloadSize,
                arrayBuffer: async () => {
                  events.push("read_oversized_body");
                  throw new Error("Oversized body must not be read");
                },
              },
              error: null,
            };
          const data = objects.get(path);
          return data
            ? { data: new Blob([new Uint8Array(data)]), error: null }
            : { data: null, error: { statusCode: "404" } };
        },
      }),
    },
  } as unknown as SupabaseClient;
  const archive = async () => {
    archiveCalls++;
    return {
      zipBuffer: bytes,
      payload: { metadata: { totalRecords: 1, totalDatasets: 48 } },
      manifest: { totalDatasets: 48 },
    } as Awaited<ReturnType<typeof createUserDataExportArchive>>;
  };
  const send = async (params: SendEmailParams): Promise<SendEmailResult> => {
    events.push("send");
    mailCalls++;
    expect(row.status).toBe("completed");
    expect(row.delivery_status).toBe("sending");
    expect(params.idempotencyKey).toBe(`account-export/${jobId}/ready-v2`);
    expect(params.attachments).toBeUndefined();
    expect(params.text).not.toContain(".zip");
    if (options.sendThrows) throw new Error("synthetic unknown");
    return options.skip
      ? {
          outcome: "skipped",
          success: false,
          skipped: true,
          phase: "transport_setup",
          code: "disabled",
          reason: "disabled",
        }
      : accepted;
  };
  return {
    row,
    events,
    client,
    archive,
    send,
    counts: () => ({ archiveCalls, mailCalls }),
  };
}
async function run(h: ReturnType<typeof fixture>) {
  const old = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://synthetic.example.test";
  try {
    return await processClaimedDataExport({ ...h.row }, h);
  } finally {
    if (old === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = old;
  }
}
test("persists artifact intent, verifies uploaded bytes, and records intent before email", async () => {
  const h = fixture();
  const result = await run(h);
  expect(h.events).toEqual([
    "plan_artifact",
    "upload",
    "download",
    "archive_ready",
    "begin_delivery",
    "send",
    "settle_delivery",
  ]);
  expect(result).toEqual({ ready: true, delivery: "accepted" });
});
test("recovers a committed object without regenerating or uploading", async () => {
  const h = fixture({ recover: true });
  expect((await run(h)).ready).toBe(true);
  expect(h.counts()).toEqual({ archiveCalls: 0, mailCalls: 1 });
  expect(h.events).not.toContain("upload");
});
test("a mismatched stored object never becomes downloadable or sends mail", async () => {
  const h = fixture({ recover: true, digestMismatch: true });
  expect((await run(h)).ready).toBe(false);
  expect(h.counts()).toEqual({ archiveCalls: 0, mailCalls: 0 });
});
test("an oversized recovered object is refused before reading its body or sending mail", async () => {
  const size = ACCOUNT_EXPORT_MAX_ZIP_BYTES + 1;
  const h = fixture({ recover: true, downloadSize: size });
  h.row.zip_size_bytes = size;
  expect((await run(h)).ready).toBe(false);
  expect(h.events).toContain("download");
  expect(h.events).not.toContain("read_oversized_body");
  expect(h.events).not.toContain("archive_ready");
  expect(h.counts()).toEqual({ archiveCalls: 0, mailCalls: 0 });
});
for (const lost of ["plan_artifact", "archive_ready", "begin_delivery"])
  test(`lost ${lost} response prevents later side effects`, async () => {
    const h = fixture({ lost });
    await run(h);
    expect(h.counts().mailCalls).toBe(0);
    if (lost === "plan_artifact") expect(h.events).not.toContain("upload");
    if (lost === "begin_delivery")
      expect(h.row.delivery_status).toBe("sending");
  });
test("unknown upload leaves its receipt for a later claim", async () => {
  const h = fixture({ uploadUnknown: true });
  await run(h);
  expect(h.row.storage_path).not.toBeNull();
  expect(h.counts().mailCalls).toBe(0);
});
test("skipped mail leaves a ready archive without claiming acceptance", async () => {
  const h = fixture({ skip: true });
  expect(await run(h)).toEqual({ ready: true, delivery: "skipped" });
});
test("unknown mail outcome is retained and never automatically resent", async () => {
  const h = fixture({ sendThrows: true });
  expect(await run(h)).toEqual({ ready: true, delivery: "unknown" });
  await run(h);
  expect(h.counts().mailCalls).toBe(1);
  expect(h.row.delivery_status).toBe("sending");
});
test("lost settlement cannot turn accepted provider delivery into a new attempt", async () => {
  const h = fixture({ lost: "settle_delivery" });
  await run(h);
  await run(h);
  expect(h.counts().mailCalls).toBe(1);
  expect(h.row.status).toBe("completed");
});
test("another account's object path is refused before Storage access", async () => {
  const h = fixture({ recover: true });
  h.row.storage_path = `fa900000-0000-4000-8000-000000000009/${jobId}/${lease}.zip`;
  await run(h);
  expect(h.events).not.toContain("download");
  expect(h.counts().mailCalls).toBe(0);
});
