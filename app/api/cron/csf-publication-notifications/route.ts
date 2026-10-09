import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { NextRequest, NextResponse } from "next/server";

import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";
import { isCsfWorkerEnabled } from "@/lib/cron/csf-worker-controls";
import { runCsfPublicationNotificationWorker } from "@/lib/plugins/private/plugins/dvhs-csf/services/publication-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.CSF_PUBLICATION_NOTIFICATIONS_SECRET_TOKEN),
  );
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probe = cronAuthShapeProbe("csf-publication-notifications", request);
  if (probe) return probe;

  if (!(await isCsfWorkerEnabled("publication_notifications"))) {
    return NextResponse.json({ enabled: false });
  }

  return observeWorkerRun("csf-publication-notifications", async () => {
    try {
      const result = await runCsfPublicationNotificationWorker();
      return NextResponse.json({ enabled: true, ...result });
    } catch {
      return NextResponse.json({ error: "Worker run failed" }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
