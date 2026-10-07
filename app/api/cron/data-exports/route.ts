import { NextRequest, NextResponse } from "next/server";

import { processPendingDataExportJobs } from "@/lib/supabase/data-export-jobs";
import { logError } from "@/lib/logger";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";

function authorizeCronRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron secret not configured" },
        { status: 500 },
      ),
    };
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true } as const;
}

async function runProcessor(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  // Strictly after real authentication and before the limit parse, Storage, and
  // processPendingDataExportJobs(). This single seam covers GET and POST, both
  // of which dispatch through runProcessor().
  const probe = cronAuthShapeProbe("data-exports", request);
  if (probe) return probe;

  const limitParam = Number(request.nextUrl.searchParams.get("limit") || "1");
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 5)
      : 1;

  try {
    const result = await processPendingDataExportJobs(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logError("Data export cron failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Data export processing could not be confirmed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return runProcessor(request);
}

export async function POST(request: NextRequest) {
  return runProcessor(request);
}
