import { NextRequest, NextResponse } from "next/server";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";
import { readPositiveInteger } from "@/lib/async/map-with-concurrency";
import {
  CANCELLATION_WORKER_MAX_BATCH_SIZE,
  CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  runProjectCancellationWorker,
} from "@/services/project-cancellation-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RUN_DEADLINE_MS = 45_000;

/**
 * The project cancellation worker endpoint.
 *
 * It owns no dispatch logic: claiming, leasing, sending, settling, and
 * finalizing all live in the worker service and its RPCs, so the inline kick
 * from the cancelling Server Action and the scheduled cron run can call this
 * concurrently without either one deciding what the other already did.
 *
 * The response is aggregate-only on purpose. Job ids, delivery ids, recipient
 * ids, addresses, and provider error text never leave this handler — the
 * caller of a cron endpoint has no authorization context, so a count is the
 * most it may learn.
 */

function isAuthorized(request: NextRequest): boolean {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.PROJECT_CANCELLATION_WORKER_SECRET_TOKEN),
  );
}

function isWorkerEnabled(): boolean {
  return process.env.PROJECT_CANCELLATION_WORKER_ENABLED === "true";
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Strictly after real authentication and before the worker-enable check,
  // getAdminClient(), any query, any email, and the worker itself.
  const probe = cronAuthShapeProbe("project-cancellations", request);
  if (probe) return probe;

  if (!isWorkerEnabled()) {
    return NextResponse.json(
      {
        enabled: false,
        message: "Project cancellation worker is disabled",
      },
      { status: 200 },
    );
  }

  const batchSize = readPositiveInteger(
    process.env.PROJECT_CANCELLATION_WORKER_BATCH_SIZE,
    50,
    CANCELLATION_WORKER_MAX_BATCH_SIZE,
  );
  const maxJobs = readPositiveInteger(
    process.env.PROJECT_CANCELLATION_WORKER_MAX_JOBS,
    3,
    CANCELLATION_WORKER_MAX_JOBS_PER_RUN,
  );

  try {
    const startedAt = Date.now();
    const result = await runProjectCancellationWorker({
      batchSize,
      maxJobs,
      deadlineMs: RUN_DEADLINE_MS,
    });

    // Aggregates only: no ids, no addresses, no provider error text.
    return NextResponse.json(
      {
        enabled: true,
        ...result,
        durationMs: Date.now() - startedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Project cancellation worker failed:", error);
    return NextResponse.json({ error: "Worker run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const probe = cronAuthShapeProbe("project-cancellations", request);
    if (probe) return probe;

    return NextResponse.json(
      {
        message: "Project cancellation worker is running",
        enabled: isWorkerEnabled(),
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  return handle(request);
}
