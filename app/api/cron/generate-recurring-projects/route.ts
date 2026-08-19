import { NextRequest, NextResponse } from "next/server";

import { processRecurringProjects } from "@/services/recurring-project-worker";

function getAllowedCronTokens(): string[] {
  return [
    process.env.CRON_TOKEN,
    process.env.CRON_SECRET,
    process.env.RECURRING_PROJECTS_SECRET_TOKEN,
  ].filter((value): value is string => Boolean(value));
}

function authorizeCronRequest(
  request: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const allowedTokens = getAllowedCronTokens();

  if (allowedTokens.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron auth not configured" },
        { status: 500 },
      ),
    };
  }

  if (!token || !allowedTokens.includes(token)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    const startTime = Date.now();
    const result = await processRecurringProjects();
    const executionTime = Date.now() - startTime;

    return NextResponse.json(
      {
        message: "Recurring projects processed",
        processedProjects: result.processedProjects,
        createdOccurrences: result.createdOccurrences,
        failedProjects: result.errors.length,
        executionTimeMs: executionTime,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    return NextResponse.json({
      message: "Recurring projects cron service is running",
      timestamp: new Date().toISOString(),
    });
  }

  return POST(request);
}
