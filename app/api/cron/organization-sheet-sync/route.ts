import { NextRequest, NextResponse } from "next/server";
import {
  mapWithConcurrency,
  readPositiveInteger,
} from "@/lib/async/map-with-concurrency";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buildOrganizationReportRowsForSync,
  type ReportType,
} from "@/lib/organization/report-service";
import {
  replaceSpreadsheetReportValues,
} from "@/services/google-sheets";
import {
  getGoogleAccessTokenForSheetsForUser,
  organizationSheetsGoogleBinding,
} from "@/services/calendar";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";

const WORKER_ENABLED = process.env.ORG_SHEET_SYNC_WORKER_ENABLED === "true";
const WORKER_TOKEN = process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN;
const CRON_SECRET = process.env.CRON_TOKEN ?? process.env.CRON_SECRET;
const DEFAULT_TAB_NAME = "Member Hours";
const SHEET_SYNC_CONCURRENCY = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_CONCURRENCY,
  3,
  10,
);

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  const allowedTokens = [WORKER_TOKEN, CRON_SECRET].filter(
    (value): value is string => Boolean(value)
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
  // getAdminClient(), any query, the Google OAuth authorization, the Sheets
  // access token, and replaceSpreadsheetReportValues().
  const probe = cronAuthShapeProbe("organization-sheet-sync", request);
  if (probe) return probe;

  if (!WORKER_ENABLED) {
    return NextResponse.json({ message: "Sheet sync worker disabled" }, { status: 200 });
  }

  const supabase = getAdminClient();
  const { data: syncRows, error } = await supabase
    .from("organization_sheet_syncs")
    .select(
      "organization_id, sheet_id, sheet_url, tab_name, range_a1, report_type, auto_sync, sync_interval_minutes, last_synced_at, created_by"
    )
    .eq("auto_sync", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dueRows = (syncRows || []).filter((row) =>
    isDue(row.last_synced_at, row.sync_interval_minutes || 1440),
  );
  const results = await mapWithConcurrency(
    dueRows,
    SHEET_SYNC_CONCURRENCY,
    async (row) => {
      try {
        const ownerAuthorization = await authorizeGoogleOAuthOrganizationRequest({
          userId: row.created_by,
          organizationId: row.organization_id,
          pluginKey: null,
          purpose: "organization_sheets",
          requestedCapability: null,
        });
        if (!ownerAuthorization.allowed) {
          await supabase
            .from("organization_sheet_syncs")
            .update({ auto_sync: false, updated_at: new Date().toISOString() })
            .eq("organization_id", row.organization_id);
          return {
            organizationId: row.organization_id,
            success: false,
            error: "Sync owner no longer has active organization admin access",
          };
        }

        const accessToken = await getGoogleAccessTokenForSheetsForUser(
          row.created_by,
          true,
          organizationSheetsGoogleBinding(row.organization_id),
        );
        if (!accessToken) {
          return { organizationId: row.organization_id, success: false, error: "No Google token" };
        }

        const { rows, error: rowsError } = await buildOrganizationReportRowsForSync(
          row.organization_id,
          row.report_type as ReportType
        );

        if (rowsError || !rows) {
          return { organizationId: row.organization_id, success: false, error: rowsError || "Report error" };
        }

        const replacement = await replaceSpreadsheetReportValues(
          accessToken,
          row.sheet_id,
          row.tab_name || DEFAULT_TAB_NAME,
          row.range_a1,
          rows,
        );

        if (!replacement.success && replacement.stage === "write") {
          return { organizationId: row.organization_id, success: false, error: "Sheet update failed" };
        }

        if (!replacement.success) {
          return {
            organizationId: row.organization_id,
            success: false,
            error: "Sheet updated, but stale values could not be cleared",
          };
        }

        await supabase
          .from("organization_sheet_syncs")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("organization_id", row.organization_id);

        return { organizationId: row.organization_id, success: true };
      } catch (error) {
        return {
          organizationId: row.organization_id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  return NextResponse.json({ processed: results.length, results }, { status: 200 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
