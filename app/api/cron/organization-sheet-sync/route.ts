import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buildOrganizationReportRowsForSync,
  type ReportType,
} from "@/app/organization/[id]/reports/actions";
import { buildWriteRange, updateSpreadsheetValues } from "@/services/google-sheets";
import { getGoogleAccessTokenForSheetsForUser } from "@/services/calendar";

const WORKER_ENABLED = process.env.ORG_SHEET_SYNC_WORKER_ENABLED === "true";
const WORKER_TOKEN = process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;
const DEFAULT_TAB_NAME = "Member Hours";

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

  const results: Array<{ organizationId: string; success: boolean; error?: string }> = [];

  for (const row of syncRows || []) {
    const intervalMinutes = row.sync_interval_minutes || 1440;
    if (!isDue(row.last_synced_at, intervalMinutes)) {
      continue;
    }

    const accessToken = await getGoogleAccessTokenForSheetsForUser(
      row.created_by,
      true
    );
    if (!accessToken) {
      results.push({ organizationId: row.organization_id, success: false, error: "No Google token" });
      continue;
    }

    const { rows, error: rowsError } = await buildOrganizationReportRowsForSync(
      row.organization_id,
      row.report_type as ReportType
    );

    if (rowsError || !rows) {
      results.push({ organizationId: row.organization_id, success: false, error: rowsError || "Report error" });
      continue;
    }

    const range = buildWriteRange(row.tab_name || DEFAULT_TAB_NAME, row.range_a1, rows);
    const updated = await updateSpreadsheetValues(accessToken, row.sheet_id, range, rows);

    if (!updated) {
      results.push({ organizationId: row.organization_id, success: false, error: "Sheet update failed" });
      continue;
    }

    await supabase
      .from("organization_sheet_syncs")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("organization_id", row.organization_id);

    results.push({ organizationId: row.organization_id, success: true });
  }

  return NextResponse.json({ processed: results.length, results }, { status: 200 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}