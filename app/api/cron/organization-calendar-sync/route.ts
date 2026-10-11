import { workerResponseSummary } from "@/lib/cron/worker-response-summary";
import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { workerHeartbeatOwner } from "@/lib/cron/worker-heartbeat";
import { safeConsole } from "@/lib/safe-console";
import { NextRequest, NextResponse } from "next/server";
import { readPositiveInteger } from "@/lib/async/map-with-concurrency";
import { getAdminClient } from "@/lib/supabase/admin";
import { syncOrganizationCalendarInternal } from "@/lib/organization/calendar-sync";
import {
  runOrganizationCalendarSyncQueue,
  type CalendarSyncQueueClient,
} from "@/lib/organization/calendar-sync-queue";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";

export const maxDuration = 60;

const WORKER_ENABLED = process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED !== "false";
const CALENDAR_SYNC_CONCURRENCY = readPositiveInteger(
  process.env.ORG_CALENDAR_SYNC_CONCURRENCY,
  3,
  10,
);

// Every bound below comes from the deployment's environment or from this
// file. Nothing in the request can raise one.
const MAX_ORGANIZATIONS_PER_RUN = readPositiveInteger(
  process.env.ORG_CALENDAR_SYNC_MAX_PER_RUN,
  25,
  200,
);
// No query runs and no organization starts once the run is this close to the
// function limit.
const RUN_BUDGET_MS = maxDuration * 1000 - 10_000;
// One organization gets this long, so a slow or very large calendar for one
// tenant cannot use up the run for the others.
const ORGANIZATION_BUDGET_MS = readPositiveInteger(
  process.env.ORG_CALENDAR_SYNC_ORG_BUDGET_MS,
  30_000,
  30_000,
);
const MINIMUM_START_BUDGET_MS = Math.min(5_000, ORGANIZATION_BUDGET_MS);
// How long a slot waits for a timed-out organization's work to end before
// the next organization may use it.
const SETTLE_GRACE_MS = Math.min(2_000, ORGANIZATION_BUDGET_MS);

function isAuthorized(request: NextRequest) {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN),
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Strictly after real authentication and before the worker-enable check,
  // getAdminClient(), any query, and syncOrganizationCalendarInternal().
  const probe = cronAuthShapeProbe("organization-calendar-sync", request);
  if (probe) return probe;

  if (!WORKER_ENABLED) {
    return NextResponse.json(
      { enabled: false, message: "Calendar sync worker disabled" },
      { status: 503 },
    );
  }

  const summary = workerResponseSummary("organization-calendar-sync");
  return observeWorkerRun(
    "organization-calendar-sync",
    async () => {
      const { status, body } = await runOrganizationCalendarSyncQueue({
        // The queue makes one service-only database call for its batch.
        supabase: getAdminClient() as unknown as CalendarSyncQueueClient,
        sync: syncOrganizationCalendarInternal,
        limits: {
          maxOrganizations: MAX_ORGANIZATIONS_PER_RUN,
          concurrency: CALENDAR_SYNC_CONCURRENCY,
          runBudgetMs: RUN_BUDGET_MS,
          minimumStartBudgetMs: MINIMUM_START_BUDGET_MS,
          organizationBudgetMs: ORGANIZATION_BUDGET_MS,
          settleGraceMs: SETTLE_GRACE_MS,
        },
        onThrown: (organizationId, error) =>
          safeConsole.error(
            "Application diagnostic from app/api/cron/organization-calendar-sync/route",
            `Failed to sync calendar for org ${organizationId}:`,
            error,
          ),
      });

      // Captured even when discovery failed, so an unread queue is recorded
      // as blocked with unknown counts instead of as a healthy empty pass.
      summary.capture(body);
      return NextResponse.json(
        {
          ...(status === 500
            ? { error: "Calendar sync discovery failed" }
            : {}),
          ...body,
          timestamp: new Date().toISOString(),
        },
        { status },
      );
    },
    summary,
    undefined,
    { heartbeatOwner: workerHeartbeatOwner(request) },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
