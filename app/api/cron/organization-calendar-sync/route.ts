import { NextRequest, NextResponse } from "next/server";
import {
  mapWithConcurrency,
  readPositiveInteger,
} from "@/lib/async/map-with-concurrency";
import { getAdminClient } from "@/lib/supabase/admin";
import { syncOrganizationCalendarInternal } from "@/lib/organization/calendar-sync";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";

const WORKER_ENABLED = process.env.ORG_CALENDAR_SYNC_WORKER_ENABLED !== "false";
const WORKER_TOKEN = process.env.ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN;
const CRON_SECRET = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;
const CALENDAR_SYNC_CONCURRENCY = readPositiveInteger(
  process.env.ORG_CALENDAR_SYNC_CONCURRENCY,
  3,
  10,
);

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  const allowedTokens = [WORKER_TOKEN, CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );

  if (allowedTokens.length === 0) {
    return false;
  }

  if (!token || !allowedTokens.includes(token)) {
    return false;
  }

  return true;
}

function isDue(lastSyncedAt: string | null, intervalMinutes: number) {
  if (!lastSyncedAt) return true;
  const last = new Date(lastSyncedAt).getTime();
  return Date.now() - last >= intervalMinutes * 60 * 1000;
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
      { message: "Calendar sync worker disabled" },
      { status: 200 },
    );
  }

  const supabase = getAdminClient();
  const { data: syncRows, error } = await supabase
    .from("organization_calendar_syncs")
    .select(
      "organization_id, calendar_id, calendar_email, auto_sync, last_synced_at, created_by",
    )
    .eq("auto_sync", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Default sync interval for calendar is 1 hour (60 minutes)
  const intervalMinutes = 60;

  const dueRows = (syncRows || []).filter((row) =>
    isDue(row.last_synced_at, intervalMinutes),
  );
  const results = await mapWithConcurrency(
    dueRows,
    CALENDAR_SYNC_CONCURRENCY,
    async (row) => {
      try {
        const result = await syncOrganizationCalendarInternal(
          row.organization_id,
        );

        if (result.success) {
          return {
            organizationId: row.organization_id,
            success: true,
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
            removedCount: result.removedCount,
          };
        } else {
          return {
            organizationId: row.organization_id,
            success: false,
            error: result.error || "Unknown error",
          };
        }
      } catch (error) {
        console.error(
          `Failed to sync calendar for org ${row.organization_id}:`,
          error,
        );
        return {
          organizationId: row.organization_id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  return NextResponse.json(
    {
      processed: results.length,
      results,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
