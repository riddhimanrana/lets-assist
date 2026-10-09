import { workerResponseSummary } from "@/lib/cron/worker-response-summary";
import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { NextRequest, NextResponse } from "next/server";
import {
  mapWithConcurrency,
  readPositiveInteger,
} from "@/lib/async/map-with-concurrency";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  ORGANIZATION_SHEET_SYNC_COLUMNS,
  runOrganizationSheetSync,
} from "@/lib/google-sheets/organization-report-sync";
import { logError, logInfo, logWarn } from "@/lib/logger";
import {
  getGoogleAccessTokenForSheetsForUser,
  organizationSheetsGoogleBinding,
} from "@/services/calendar";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import { cronAuthShapeProbe } from "@/lib/cron/auth-shape-probe";
import { cronTokens, isCronBearerAuthorized } from "@/lib/cron/cron-auth";

export const maxDuration = 60;

const WORKER_ENABLED = process.env.ORG_SHEET_SYNC_WORKER_ENABLED === "true";
const SHEET_SYNC_CONCURRENCY = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_CONCURRENCY,
  3,
  10,
);

// One run takes the least recently synced organizations first and leaves the
// rest for the next run, so a long queue cannot outlast the function limit.
const MAX_ORGANIZATIONS_PER_RUN = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_MAX_PER_RUN,
  25,
  200,
);

type SheetSyncRunResult =
  | { organizationId: string; success: true }
  | { organizationId: string; success: false; error: string; code: string };

function failed(
  organizationId: string,
  code: string,
  error: string,
): SheetSyncRunResult {
  // The response body is only read by the worker summary, so each failure is
  // also logged with a code that can be searched and alerted on.
  logWarn("Organization sheet sync failed", {
    organization_id: organizationId,
    error_code: code,
  });
  return { organizationId, success: false, error, code };
}

function isAuthorized(request: NextRequest) {
  return isCronBearerAuthorized(
    request.headers.get("authorization"),
    cronTokens(process.env.ORG_SHEET_SYNC_WORKER_SECRET_TOKEN),
  );
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
  // access token, and runOrganizationSheetSync().
  const probe = cronAuthShapeProbe("organization-sheet-sync", request);
  if (probe) return probe;

  if (!WORKER_ENABLED) {
    return NextResponse.json(
      { message: "Sheet sync worker disabled" },
      { status: 200 },
    );
  }

  const summary = workerResponseSummary("organization-sheet-sync");
  return observeWorkerRun(
    "organization-sheet-sync",
    async () => {
      const supabase = getAdminClient();
      const { data: syncRows, error } = await supabase
        .from("organization_sheet_syncs")
        .select(
          `${ORGANIZATION_SHEET_SYNC_COLUMNS}, auto_sync, sync_interval_minutes, last_synced_at, created_by`,
        )
        .eq("auto_sync", true)
        .order("last_synced_at", { ascending: true, nullsFirst: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const dueRows = (syncRows || []).filter((row) =>
        isDue(row.last_synced_at, row.sync_interval_minutes || 1440),
      );
      const selectedRows = dueRows.slice(0, MAX_ORGANIZATIONS_PER_RUN);
      if (dueRows.length > selectedRows.length) {
        logInfo("Organization sheet sync deferred organizations", {
          deferred: dueRows.length - selectedRows.length,
          selected: selectedRows.length,
        });
      }

      const results = await mapWithConcurrency(
        selectedRows,
        SHEET_SYNC_CONCURRENCY,
        async (row): Promise<SheetSyncRunResult> => {
          try {
            const ownerAuthorization =
              await authorizeGoogleOAuthOrganizationRequest({
                userId: row.created_by,
                organizationId: row.organization_id,
                pluginKey: null,
                purpose: "organization_sheets",
                requestedCapability: null,
              });
            if (!ownerAuthorization.allowed) {
              await supabase
                .from("organization_sheet_syncs")
                .update({
                  auto_sync: false,
                  updated_at: new Date().toISOString(),
                })
                .eq("organization_id", row.organization_id);
              return failed(
                row.organization_id,
                "owner_not_admin",
                "Sync owner no longer has active organization admin access",
              );
            }

            const accessToken = await getGoogleAccessTokenForSheetsForUser(
              row.created_by,
              true,
              organizationSheetsGoogleBinding(row.organization_id),
            );
            if (!accessToken) {
              return failed(
                row.organization_id,
                "no_google_token",
                "No Google token",
              );
            }

            // The same function the manual "Sync now" action runs, so the
            // saved layout, the range check and the tab check cannot drift.
            const result = await runOrganizationSheetSync({
              supabase,
              config: row,
              accessToken,
            });
            if (!result.success) {
              return failed(row.organization_id, result.code, result.error);
            }

            return { organizationId: row.organization_id, success: true };
          } catch (error) {
            logError("Organization sheet sync threw", error, {
              organization_id: row.organization_id,
            });
            return failed(
              row.organization_id,
              "unexpected_error",
              "Unexpected error",
            );
          }
        },
      );

      summary.capture({ processed: results.length, results });
      return NextResponse.json(
        { processed: results.length, results },
        { status: 200 },
      );
    },
    summary,
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
