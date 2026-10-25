import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.CSF_SCHEDULED_POST_PUBLISHER_SECRET_TOKEN),
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const probe = cronAuthShapeProbe("csf-scheduled-post-publisher", request);
  if (probe) return probe;
  // Keep old callers harmless while their deployment is replaced.
  return NextResponse.json(
    {
      enabled: false,
      retired: true,
      examined: 0,
      published: 0,
      held: 0,
      organizationsChanged: 0,
      cacheRefreshFailures: 0,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
