import { NextRequest, NextResponse } from "next/server";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";
import { observeWorkerRun } from "@/lib/cron/worker-observation";

import { runCsfStorageCleanup } from "@/lib/plugins/private/plugins/dvhs-csf/services/csf-cleanup-orchestration";
import {
  drainCsfProofStorageDeletionQueue,
  enqueueStaleCsfProofUploads,
  sweepCsfStagingObjects,
} from "@/lib/plugins/private/plugins/dvhs-csf/services/proof-storage";

const STALE_AFTER_MS = 60 * 60 * 1000;

function authorizeCronRequest(request: NextRequest) {
  const tokens = cronTokens();
  if (tokens.length === 0) {
    return NextResponse.json(
      { error: "Cron secret not configured" },
      { status: 500 },
    );
  }
  if (!isCronBearerAuthorized(request.headers.get("authorization"), tokens)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  return observeWorkerRun("csf-proof-cleanup", async () => {
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
  });
}
