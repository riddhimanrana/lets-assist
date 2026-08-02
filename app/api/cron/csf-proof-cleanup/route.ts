import { NextRequest, NextResponse } from "next/server";

import { runCsfStorageCleanup } from "@/lib/plugins/private/plugins/dvhs-csf/services/csf-cleanup-orchestration";
import {
  drainCsfProofStorageDeletionQueue,
  enqueueStaleCsfProofUploads,
  sweepCsfStagingObjects,
} from "@/lib/plugins/private/plugins/dvhs-csf/services/proof-storage";

const STALE_AFTER_MS = 60 * 60 * 1000;

function authorizeCronRequest(request: NextRequest) {
  const secret = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  // The ordering and the failure semantics live in the orchestration seam, so
  // they are proved by execution rather than by reading this handler. The route
  // keeps only what is genuinely its own: the secret check and the status code.
  const report = await runCsfStorageCleanup({
    drainDeletionQueue: () => drainCsfProofStorageDeletionQueue(),
    // The staging sweeper. It has been granted and unused since the recovery
    // migration, so abandoned uploads, expired claims and pending retirements
    // were never settled by any deploy.
    sweepStagingObjects: () => sweepCsfStagingObjects(),
    enqueueStaleProofUploads: () =>
      enqueueStaleCsfProofUploads(new Date(Date.now() - STALE_AFTER_MS)),
  });

  return NextResponse.json(report, { status: report.ok ? 200 : 500 });
}
