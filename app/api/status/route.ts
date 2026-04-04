import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

type CheckState = "pass" | "warn" | "fail";

type StatusCheck = {
  name: string;
  state: CheckState;
  critical: boolean;
  durationMs: number;
  message: string;
  details?: Record<string, unknown>;
};

function isDeepCheckEnabled(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get("deep");
  if (!value) return false;

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function runCheck(
  name: string,
  critical: boolean,
  fn: () => Promise<Omit<StatusCheck, "name" | "critical" | "durationMs">>
): Promise<StatusCheck> {
  const started = Date.now();

  try {
    const result = await fn();
    return {
      name,
      critical,
      durationMs: Date.now() - started,
      ...result,
    };
  } catch (error) {
    return {
      name,
      critical,
      state: "fail",
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function checkEnvironment(): Promise<StatusCheck> {
  return runCheck("environment", true, async () => {
    const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "CRON_SECRET"];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      return {
        state: "fail",
        message: "Required environment variables are missing",
        details: { missing },
      };
    }

    const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const isLocalSupabaseUrl =
      configuredSupabaseUrl.includes("127.0.0.1:54321") ||
      configuredSupabaseUrl.includes("localhost:54321");

    if (process.env.NODE_ENV === "development" && !isLocalSupabaseUrl) {
      return {
        state: "warn",
        message: "Development mode is configured to a non-local Supabase URL",
        details: {
          configuredSupabaseUrl,
          expectedLocalUrl: "http://127.0.0.1:54321",
        },
      };
    }

    return {
      state: "pass",
      message: "Required environment variables are configured",
    };
  });
}

async function checkDatabase(): Promise<StatusCheck> {
  return runCheck("database", true, async () => {
    const supabase = getAdminClient();

    const { error, count } = await supabase
      .from("projects")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return {
        state: "fail",
        message: `Database connectivity check failed: ${error.message}`,
      };
    }

    return {
      state: "pass",
      message: "Database connectivity check passed",
      details: { projectsCountApprox: count ?? null },
    };
  });
}

async function checkWorkerConfiguration(): Promise<StatusCheck> {
  return runCheck("workers", false, async () => {
    const workerFlags = {
      autoPublishHours: process.env.AUTO_PUBLISH_ENABLED === "true",
      organizationCalendarSync: process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED !== "false",
      organizationSheetSync: process.env.ORG_SHEET_SYNC_WORKER_ENABLED === "true",
      projectCancellationWorker: process.env.PROJECT_CANCELLATION_WORKER_ENABLED === "true",
    };

    const enabledWorkers = Object.entries(workerFlags)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);

    if (enabledWorkers.length === 0) {
      return {
        state: "warn",
        message: "All background workers are disabled",
        details: workerFlags,
      };
    }

    return {
      state: "pass",
      message: `${enabledWorkers.length} worker(s) enabled`,
      details: workerFlags,
    };
  });
}

async function checkTablesDeep(): Promise<StatusCheck> {
  return runCheck("tables-deep", false, async () => {
    const supabase = getAdminClient();
    const tables = [
      "projects",
      "project_signups",
      "organization_calendar_syncs",
      "organization_sheet_syncs",
      "project_cancellation_jobs",
      "waiver_signatures",
      "certificates",
    ];

    const tableStates: Record<string, { state: CheckState; message?: string }> = {};
    let failedCount = 0;

    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .select("*", { head: true, count: "exact" })
        .limit(1);

      if (error) {
        failedCount++;
        tableStates[table] = { state: "fail", message: error.message };
      } else {
        tableStates[table] = { state: "pass" };
      }
    }

    if (failedCount > 0) {
      return {
        state: "warn",
        message: `${failedCount} table check(s) failed`,
        details: { tableStates },
      };
    }

    return {
      state: "pass",
      message: "All deep table checks passed",
      details: { tableStates },
    };
  });
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const deep = isDeepCheckEnabled(request);

  const checks: StatusCheck[] = [];

  const envCheck = await checkEnvironment();
  checks.push(envCheck);

  if (envCheck.state === "pass") {
    checks.push(await checkDatabase());
  } else {
    checks.push({
      name: "database",
      state: "fail",
      critical: true,
      durationMs: 0,
      message: "Skipped because required environment variables are missing",
    });
  }

  checks.push(await checkWorkerConfiguration());

  if (deep && checks.find((c) => c.name === "database")?.state === "pass") {
    checks.push(await checkTablesDeep());
  }

  const criticalFailure = checks.some((check) => check.critical && check.state === "fail");
  const hasNonPass = checks.some((check) => check.state !== "pass");

  const status = criticalFailure
    ? "outage"
    : hasNonPass
      ? "degraded"
      : "operational";

  const responseStatus = criticalFailure ? 503 : 200;

  return NextResponse.json(
    {
      service: "lets-assist",
      status,
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.VERCEL_GIT_COMMIT_SHA || null,
      deep,
      checks,
      durationMs: Date.now() - started,
    },
    {
      status: responseStatus,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function HEAD(request: NextRequest) {
  const response = await GET(request);

  return new NextResponse(null, {
    status: response.status,
    headers: response.headers,
  });
}