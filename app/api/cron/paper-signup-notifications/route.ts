import { NextRequest, NextResponse } from "next/server";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";
import { runPaperSignupNotificationWorker } from "@/services/paper-signup-notification-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.PAPER_SIGNUP_NOTIFICATION_WORKER_SECRET_TOKEN),
  );
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const probe = cronAuthShapeProbe("paper-signup-notifications", request);
  if (probe) return probe;

  if (process.env.PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED !== "true") {
    return NextResponse.json({ enabled: false });
  }

  try {
    const result = await runPaperSignupNotificationWorker();
    return NextResponse.json({ enabled: true, ...result });
  } catch {
    return NextResponse.json({ error: "Worker run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
