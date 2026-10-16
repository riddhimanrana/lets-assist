import { workerResponseSummary } from "@/lib/cron/worker-response-summary";
import { observeWorkerRun } from "@/lib/cron/worker-observation";
import { workerHeartbeatOwner } from "@/lib/cron/worker-heartbeat";
import { NextRequest, NextResponse } from "next/server";
import {
  mapWithConcurrency,
  readPositiveInteger,
} from "@/lib/async/map-with-concurrency";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  ORGANIZATION_SHEET_SYNC_COLUMNS,
  runOrganizationSheetSync,
  type OrganizationSheetSyncConfig,
} from "@/lib/google-sheets/organization-report-sync";
import {
  discoverDueSheetSyncs,
  type SheetSyncQueueClient,
} from "@/lib/google-sheets/organization-sync-queue";
import { logError, logInfo, logWarn } from "@/lib/logger";
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
// No query runs and no organization starts once the run is this close to the
// function limit.
const RUN_BUDGET_MS = maxDuration * 1000 - 10_000;
// One organization gets this long, so a slow or very large sheet for one
// tenant cannot use up the run for the others.
const ORGANIZATION_BUDGET_MS = readPositiveInteger(
  process.env.ORG_SHEET_SYNC_ORG_BUDGET_MS,
  20_000,
  30_000,
);
const MINIMUM_START_BUDGET_MS = Math.min(5_000, ORGANIZATION_BUDGET_MS);
// How long a slot waits for a timed-out organization's work to end before
// the next organization may use it.
const SETTLE_GRACE_MS = Math.min(2_000, ORGANIZATION_BUDGET_MS);

/** A selected configuration as loaded: the sync's columns and its schedule. */
type SheetSyncRow = OrganizationSheetSyncConfig & {
  auto_sync: boolean;
  sync_interval_minutes: number;
  last_synced_at: string | null;
};

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
      { enabled: false, message: "Sheet sync worker disabled" },
      { status: 503 },
    );
  }

  const summary = workerResponseSummary("organization-sheet-sync");
  return observeWorkerRun(
    "organization-sheet-sync",
    async () => {
      const supabase = getAdminClient();
      const startedAt = Date.now();
      // Both discovery calls end with the run's budget.
      const discovery = await discoverDueSheetSyncs<SheetSyncRow>({
        supabase: supabase as unknown as SheetSyncQueueClient,
        columns: `${ORGANIZATION_SHEET_SYNC_COLUMNS}, auto_sync, sync_interval_minutes, last_synced_at`,
        maxOrganizations: MAX_ORGANIZATIONS_PER_RUN,
        startedAt,
        signal: AbortSignal.timeout(RUN_BUDGET_MS),
      });
      if (discovery.status !== "selected") {
        // Captured, so an unread queue is recorded as blocked instead of as a
        // healthy empty pass. An unknown count is not turned into a backlog.
        const body = {
          processed: 0,
          results: [],
          deferredOrganizations:
            discovery.status === "unloaded" ? discovery.dueCount : 0,
          discoveryCounted: discovery.status === "unloaded",
          discoveryIncomplete: true,
        };
        summary.capture(body);
        logWarn("Organization sheet sync discovery failed", {
          discovery: discovery.status,
        });
        return NextResponse.json(
          { error: "Sheet sync discovery failed", ...body },
          { status: 500 },
        );
      }
      const { dueCount } = discovery;
      // A configuration switched off since it was selected is not attempted.
      // It stays in this pass's deferred count, so the pass is not healthy.
      const selectedRows = discovery.rows.filter((row) => row.auto_sync);

      const syncOrganization = async (
        row: SheetSyncRow,
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
            .eq("sheet_id", row.sheet_id)
            .eq("updated_at", row.updated_at);
          return failed(
            row.organization_id,
            "owner_not_admin",
            "Sync owner no longer has active organization admin access",
          );
        }

        // The same function the manual "Sync now" action runs, so the saved
        // layout, the range check and the tab check cannot drift.
        const result = await runOrganizationSheetSync({
          supabase,
          config: row,
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
          // The slot stays taken until this organization's work has really
          // ended. Reporting a timeout while the report build carries on in
          // the background would let the next organization start beside it
          // and push the run past its concurrency limit.
          const work = syncOrganization(row, deadline);
          try {
            return await Promise.race([work, untilAborted(deadline)]);
          } catch (error) {
            // Bounded, so work that never settles cannot hold the slot for
            // the rest of the run.
            await Promise.race([
              work.catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, SETTLE_GRACE_MS)),
            ]);
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
      // Everything due at the start that was not attempted: past the cap, not
      // started because the run was near its deadline, or switched off since.
      const deferred = Math.max(0, dueCount - results.length);
      if (deferred > 0) {
        logInfo("Organization sheet sync deferred organizations", {
          deferred,
          synced: results.length,
        });
      }

      const body = {
        processed: results.length,
        results,
        deferredOrganizations: deferred,
        discoveryCounted: true,
        discoveryIncomplete: false,
      };
      summary.capture(body);
      return NextResponse.json(body, {
        status:
          deferred > 0 || results.some((result) => !result.success) ? 503 : 200,
      });
    },
    summary,
    undefined,
    { heartbeatOwner: workerHeartbeatOwner(request) },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
