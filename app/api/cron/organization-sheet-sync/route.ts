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
import {
  isSheetSyncDue,
  ORGANIZATION_SHEET_SYNC_MIN_INTERVAL_MINUTES,
  selectSheetSyncBatch,
} from "@/lib/google-sheets/organization-sync-queue";
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

// Every bound below comes from the deployment's environment or from this
// file. Nothing in the request can raise one.
const MAX_ORGANIZATIONS_PER_RUN = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_MAX_PER_RUN,
  25,
  200,
);
// The query cannot compare a row's own interval with its last sync, so it
// loads a bounded window of candidates and the exact check runs here.
const CANDIDATE_WINDOW = MAX_ORGANIZATIONS_PER_RUN * 4;
// No organization starts once the run is this close to the function limit.
const RUN_BUDGET_MS = maxDuration * 1000 - 10_000;
// One organization gets this long, so a slow or very large sheet for one
// tenant cannot use up the run for the others.
const ORGANIZATION_BUDGET_MS = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_ORG_BUDGET_MS,
  20_000,
  30_000,
);
const MINIMUM_START_BUDGET_MS = Math.min(5_000, ORGANIZATION_BUDGET_MS);

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

/** Rejects when the organization's deadline passes, whatever the work is doing. */
function untilAborted(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () =>
        reject(new DOMException("Organization budget spent", "TimeoutError")),
      { once: true },
    );
  });
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
      const startedAt = Date.now();
      const earliestDue = new Date(
        startedAt - ORGANIZATION_SHEET_SYNC_MIN_INTERVAL_MINUTES * 60 * 1000,
      ).toISOString();
      const { data: syncRows, error } = await supabase
        .from("organization_sheet_syncs")
        .select(
          `${ORGANIZATION_SHEET_SYNC_COLUMNS}, auto_sync, sync_interval_minutes, last_synced_at`,
        )
        .eq("auto_sync", true)
        .or(`last_synced_at.is.null,last_synced_at.lte.${earliestDue}`)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(CANDIDATE_WINDOW);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const dueRows = (syncRows || []).filter((row) =>
        isSheetSyncDue(
          row.last_synced_at,
          row.sync_interval_minutes || 1440,
          startedAt,
        ),
      );
      const selectedRows = selectSheetSyncBatch(
        dueRows,
        MAX_ORGANIZATIONS_PER_RUN,
        startedAt,
      );

      const syncOrganization = async (
        row: (typeof selectedRows)[number],
        signal: AbortSignal,
      ): Promise<SheetSyncRunResult> => {
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
            // Only the configuration that was just checked. If an admin has
            // since changed the owner or the spreadsheet, leave theirs alone.
            .eq("organization_id", row.organization_id)
            .eq("created_by", row.created_by)
            .eq("sheet_id", row.sheet_id);
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

        // The same function the manual "Sync now" action runs, so the saved
        // layout, the range check and the tab check cannot drift.
        const result = await runOrganizationSheetSync({
          supabase,
          config: row,
          accessToken,
          signal,
        });
        return result.success
          ? { organizationId: row.organization_id, success: true }
          : failed(row.organization_id, result.code, result.error);
      };

      const outcomes = await mapWithConcurrency(
        selectedRows,
        SHEET_SYNC_CONCURRENCY,
        async (row): Promise<SheetSyncRunResult | null> => {
          const remaining = RUN_BUDGET_MS - (Date.now() - startedAt);
          // Too little of the run is left to finish another organization.
          if (remaining < MINIMUM_START_BUDGET_MS) return null;

          const deadline = AbortSignal.timeout(
            Math.min(ORGANIZATION_BUDGET_MS, remaining),
          );
          try {
            return await Promise.race([
              syncOrganization(row, deadline),
              untilAborted(deadline),
            ]);
          } catch (error) {
            if (deadline.aborted) {
              return failed(
                row.organization_id,
                "organization_budget_exceeded",
                "The sync took too long and was stopped",
              );
            }
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
      const results = outcomes.filter(
        (outcome): outcome is SheetSyncRunResult => outcome !== null,
      );
      const deferred = dueRows.length - results.length;
      if (deferred > 0) {
        logInfo("Organization sheet sync deferred organizations", {
          deferred,
          synced: results.length,
        });
      }

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
