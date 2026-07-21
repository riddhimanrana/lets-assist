import { NextRequest, NextResponse } from "next/server";

import {
  drainCsfProofStorageDeletionQueue,
  enqueueStaleCsfProofUploads,
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

  const initialDrain = await drainCsfProofStorageDeletionQueue();
  if (initialDrain.error) {
    return NextResponse.json(initialDrain, { status: 500 });
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const enqueue = await enqueueStaleCsfProofUploads(cutoff);
  if (enqueue.error) {
    return NextResponse.json({ ...enqueue, initialDrain }, { status: 500 });
  }

  const finalDrain = await drainCsfProofStorageDeletionQueue();
  const result = {
    enqueued: enqueue.enqueued,
    deleted: initialDrain.deleted + finalDrain.deleted,
    failed: initialDrain.failed + finalDrain.failed,
    error: finalDrain.error,
  };
  return NextResponse.json(result, { status: finalDrain.error ? 500 : 200 });
}
