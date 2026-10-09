import { workerResponseSummary } from "@/lib/cron/worker-response-summary";
import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { safeConsole } from "@/lib/safe-console";
import { NextRequest, NextResponse } from "next/server";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { processExpiredSessions } from "@/services/auto-publish-hours-worker";

function getAllowedCronTokens(): string[] {
  const tokens = [
    process.env.CRON_TOKEN,
    process.env.CRON_SECRET,
    process.env.AUTO_PUBLISH_SECRET_TOKEN,
  ].filter((value): value is string => Boolean(value));

  return tokens;
}

function authorizeCronRequest(
  request: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization") || "";
  const token = /^Bearer ([\x21-\x7E]+)$/.exec(authHeader)?.[1];
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

// API Route Handler
export async function POST(request: NextRequest) {
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    // Strictly after real authentication and before the worker-enable check,
    // the service client, any query, any email, and processExpiredSessions().
    const probe = cronAuthShapeProbe("auto-publish-hours", request);
    if (probe) return probe;

    // Check if auto-publish is enabled
    if (process.env.AUTO_PUBLISH_ENABLED !== "true") {
      safeConsole.log("Auto-publish is disabled");
      return NextResponse.json(
        { message: "Auto-publish is disabled", processed: 0, successful: 0 },
        { status: 200 },
      );
    }

    const summary = workerResponseSummary("auto-publish-hours");
    return await observeWorkerRun(
      "auto-publish-hours",
      async () => {
        safeConsole.log("Auto-publish process initiated");
        const startTime = Date.now();

        // Process expired sessions
        const result = await processExpiredSessions();
        summary.capture(result);

        const executionTime = Date.now() - startTime;
        safeConsole.log(
          "Application diagnostic from app/api/cron/auto-publish-hours/route",
          `Auto-publish process completed in ${executionTime}ms`,
        );

        return NextResponse.json(
          {
            message: "Auto-publish process completed",
            processedSessions: result.processedSessions,
            successfulSessions: result.successfulSessions,
            pendingSessions: result.pendingSessions,
            executionTimeMs: executionTime,
            results: result.results,
          },
          { status: 200 },
        );
      },
      summary,
    );
  } catch (error: unknown) {
    safeConsole.error("Error in auto-publish API route:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 },
    );
  }
}

// Also support GET for testing/monitoring
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    const probe = cronAuthShapeProbe("auto-publish-hours", request);
    if (probe) return probe;

    return NextResponse.json({
      message: "Auto-publish service is running",
      enabled: process.env.AUTO_PUBLISH_ENABLED === "true",
      timestamp: new Date().toISOString(),
    });
  }

  return POST(request);
}
