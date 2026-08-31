import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { createPluginAdminClient } from "@/lib/plugins/supabase";
import { classifyCsfImportCommitFailure } from "@/lib/plugins/private/plugins/dvhs-csf/services/import-commit-failure-code";
import type { CsfImportCommitWorkerContext } from "@/lib/plugins/private/plugins/dvhs-csf/services/import-commit-worker-context";
import { executeCsfImportCommitClaim } from "@/services/csf-import-commit-worker";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A 1,000-row import is split into receipt-backed database batches, but the
// worker still owns one fenced attempt until it can finalize the preview. The
// Pro function ceiling gives that attempt enough time to finish while each
// database request remains independently bounded.
export const maxDuration = 800;

const BEARER_GRAMMAR = /^Bearer ([\x21-\x7E]+)$/;
const claimSchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(false) }),
  z.object({
    claimed: z.literal(true),
    queueId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    organizationId: z.string().uuid(),
    previewJobId: z.string().uuid(),
    actorUserId: z.string().uuid(),
  }),
]);

function secretsMatch(expected: string, presented: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const presentedDigest = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

function isAuthorized(request: NextRequest): boolean {
  const match = BEARER_GRAMMAR.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  return [
    process.env.CSF_IMPORT_WORKER_SECRET_TOKEN,
    process.env.CRON_TOKEN ?? process.env.CRON_SECRET,
  ]
    .filter((value): value is string => Boolean(value))
    .reduce(
      (authorized, expected) => secretsMatch(expected, match[1]) || authorized,
      false,
    );
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control":
        "private, no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  const probe = cronAuthShapeProbe("csf-import-commit", request);
  if (probe) return probe;
  if (process.env.CSF_IMPORT_WORKER_ENABLED !== "true") {
    return json({ enabled: false, claimed: 0, completed: 0, blocked: 0 });
  }
  const workerSecret = process.env.CSF_IMPORT_WORKER_SECRET_TOKEN;
  if (!workerSecret) {
    return json({ error: "Import worker secret unavailable" }, 503);
  }

  const plugin = createPluginAdminClient();
  const { data, error } = await plugin.rpc("csf_claim_import_commit_queue", {
    p_lease_seconds: 300,
  });
  if (error) return json({ error: "Import queue unavailable" }, 503);
  const parsed = claimSchema.safeParse(data);
  if (!parsed.success) {
    return json({ error: "Import queue returned invalid data" }, 503);
  }
  if (!parsed.data.claimed) {
    return json({ enabled: true, claimed: 0, completed: 0, blocked: 0 });
  }

  const workerContext: CsfImportCommitWorkerContext = {
    queueId: parsed.data.queueId,
    leaseToken: parsed.data.leaseToken,
    actorUserId: parsed.data.actorUserId,
    secret: workerSecret,
  };
  const result = await executeCsfImportCommitClaim({
    organizationId: parsed.data.organizationId,
    previewJobId: parsed.data.previewJobId,
    workerContext,
  });
  const status = result.success ? "completed" : "blocked";
  const errorCode = result.success
    ? null
    : classifyCsfImportCommitFailure(result.error ?? "");
  const { error: finishError } = await plugin.rpc(
    "csf_finish_import_commit_queue",
    {
      p_queue_id: parsed.data.queueId,
      p_lease_token: parsed.data.leaseToken,
      p_status: status,
      p_result_counts: { completed: result.success ? 1 : 0 },
      p_error_code: errorCode,
    },
  );
  if (finishError) {
    return json({ error: "Import result could not be settled" }, 503);
  }
  return json({
    enabled: true,
    claimed: 1,
    completed: result.success ? 1 : 0,
    blocked: result.success ? 0 : 1,
    ...(errorCode ? { errorCode } : {}),
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
