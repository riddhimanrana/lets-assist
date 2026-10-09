import "server-only";

import {
  buildSheetRowsWithLayout,
  validateLayout,
  type ReportLayoutConfig,
} from "@/app/organization/[id]/reports/report-layouts";
import { logWarn } from "@/lib/logger";
import {
  buildOrganizationReportRowsForSync,
  type ReportType,
} from "@/lib/organization/report-service";
import type { getAdminClient } from "@/lib/supabase/admin";
import { replaceSpreadsheetReportValues } from "@/services/google-sheets";
import {
  inspectSpreadsheet,
  type SheetsFailureReason,
} from "@/services/google-sheets-report";

import {
  describeReportRangeOverflow,
  openLegacyDefaultReportRange,
} from "./ranges";

export const ORGANIZATION_SHEET_SYNC_DEFAULT_TAB = "Member Hours";

/**
 * The columns one sync needs. Both the manual action and the scheduled worker
 * select this list, so neither can leave out the saved layout.
 */
export const ORGANIZATION_SHEET_SYNC_COLUMNS =
  "organization_id, sheet_id, tab_name, range_a1, report_type, layout_config, created_by" as const;

export type OrganizationSheetSyncConfig = {
  organization_id: string;
  sheet_id: string;
  tab_name: string | null;
  range_a1: string | null;
  report_type: string;
  layout_config: unknown;
  /** The owner the caller authorized. Write-backs only touch their config. */
  created_by: string;
};

/** Stable codes for logs, the worker response and the cards. */
export type OrganizationSheetSyncErrorCode =
  | "sheet_inaccessible"
  | "sheet_not_editable"
  | "tab_missing"
  | "range_too_small"
  | "report_too_large"
  | "report_unavailable"
  | "sheets_timeout"
  | "sheets_rate_limited"
  | "sheets_rejected"
  | "sheets_unavailable"
  | "stale_clear_failed"
  | "record_failed";

export type OrganizationSheetSyncResult =
  | { success: true }
  | { success: false; code: OrganizationSheetSyncErrorCode; error: string };

/**
 * The most one sync writes. A report past either bound fails for that
 * organization instead of holding a worker on one very large sheet.
 */
export const ORGANIZATION_SHEET_SYNC_MAX_ROWS = 10_000;
export const ORGANIZATION_SHEET_SYNC_MAX_CELLS = 100_000;
/**
 * The most certificate and attendance records a report may be built from.
 * Counted before the report is loaded, so an oversized organization is
 * refused before the expensive work instead of after it.
 */
export const ORGANIZATION_SHEET_SYNC_MAX_SOURCE_RECORDS = 100_000;
/** One metadata read, one write, and two clears of stale cells. */
export const ORGANIZATION_SHEET_SYNC_MAX_SHEETS_REQUESTS = 4;

const TIMEOUT_MESSAGE =
  "Google Sheets did not respond in time. Try again in a few minutes.";

const RESELECT_MESSAGE =
  "The connected Google account cannot open this spreadsheet. Choose the file again with the picker.";

const SHEETS_FAILURES: Record<
  SheetsFailureReason,
  { code: OrganizationSheetSyncErrorCode; error: string }
> = {
  access_denied: { code: "sheet_inaccessible", error: RESELECT_MESSAGE },
  not_found: { code: "sheet_inaccessible", error: RESELECT_MESSAGE },
  timeout: { code: "sheets_timeout", error: TIMEOUT_MESSAGE },
  rate_limited: {
    code: "sheets_rate_limited",
    error:
      "Google Sheets is limiting requests right now. Try again in a few minutes.",
  },
  invalid_request: {
    code: "sheets_rejected",
    error:
      "Google Sheets rejected the tab or range. Check the destination in the sheet settings.",
  },
  unavailable: {
    code: "sheets_unavailable",
    error: "Google Sheets returned an error. Try again in a few minutes.",
  },
};

/**
 * Failures that repeat until an admin changes the destination. A sync that
 * hits one turns automatic sync off, so the worker stops retrying it.
 */
export function isPermanentSheetSyncFailure(
  code: OrganizationSheetSyncErrorCode,
) {
  return code === "sheet_inaccessible" || code === "tab_missing";
}

/** The saved layout, or null when there is none or it no longer applies. */
export function resolveSavedSheetLayout(
  layoutConfig: unknown,
  reportType: string,
): ReportLayoutConfig | null {
  if (!layoutConfig) return null;
  let layout: ReportLayoutConfig;
  try {
    layout = (
      typeof layoutConfig === "string" ? JSON.parse(layoutConfig) : layoutConfig
    ) as ReportLayoutConfig;
  } catch {
    return null;
  }
  if (
    !layout ||
    typeof layout !== "object" ||
    layout.reportType !== reportType ||
    !Array.isArray(layout.columns) ||
    !validateLayout(layout).valid
  ) {
    return null;
  }
  return layout;
}

/**
 * Runs one organization report sync: resolve the tab, build the rows with the
 * saved layout, write them, and record the sync time.
 *
 * The caller has already authorized the request and obtained the owner's
 * Sheets token. This function never creates a tab: a missing tab means the
 * destination changed, and writing somewhere new is the admin's decision.
 */
export async function runOrganizationSheetSync({
  supabase,
  config,
  accessToken,
  signal,
}: {
  supabase: ReturnType<typeof getAdminClient>;
  config: OrganizationSheetSyncConfig;
  accessToken: string;
  /** Ends every Sheets request for this organization, such as at a deadline. */
  signal?: AbortSignal;
}): Promise<OrganizationSheetSyncResult> {
  const result = await writeOrganizationReport(
    supabase,
    config,
    accessToken,
    signal,
  );

  // Work abandoned at its deadline must not go on to change the saved sync.
  if (signal?.aborted) {
    return { success: false, code: "sheets_timeout", error: TIMEOUT_MESSAGE };
  }

  // Each write-back names the owner and spreadsheet that were authorized and
  // synced. If an admin changed either while this ran, the stale result
  // matches nothing and leaves the new configuration alone.
  const authorizedConfig = () =>
    supabase
      .from("organization_sheet_syncs")
      .update(
        result.success
          ? { last_synced_at: new Date().toISOString() }
          : { auto_sync: false, updated_at: new Date().toISOString() },
      )
      .eq("organization_id", config.organization_id)
      .eq("sheet_id", config.sheet_id)
      .eq("created_by", config.created_by);

  if (!result.success) {
    if (isPermanentSheetSyncFailure(result.code)) await authorizedConfig();
    return result;
  }

  const { error: recordError } = await authorizedConfig();
  if (recordError) {
    return {
      success: false,
      code: "record_failed",
      error: "The sheet was updated, but the sync time could not be saved.",
    };
  }

  return { success: true };
}

/**
 * Counts what the report would be built from, without loading it. Returns
 * null when a count is unavailable, and the sync then fails closed.
 */
async function isReportSourceWithinBounds(
  supabase: ReturnType<typeof getAdminClient>,
  organizationId: string,
): Promise<boolean | null> {
  const [projects, certificates, attendance] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("certificates")
      .select("id, projects!inner(organization_id)", {
        count: "exact",
        head: true,
      })
      .eq("projects.organization_id", organizationId),
    supabase
      .from("project_signups")
      .select(
        "id, projects!project_signups_project_id_fkey!inner(organization_id)",
        {
          count: "exact",
          head: true,
        },
      )
      .eq("projects.organization_id", organizationId)
      .not("check_out_time", "is", null),
  ]);
  if (
    projects.error ||
    certificates.error ||
    attendance.error ||
    projects.count === null ||
    certificates.count === null ||
    attendance.count === null
  ) {
    return null;
  }
  return (
    projects.count <= ORGANIZATION_SHEET_SYNC_MAX_ROWS &&
    certificates.count + attendance.count <=
      ORGANIZATION_SHEET_SYNC_MAX_SOURCE_RECORDS
  );
}

const REPORT_TOO_LARGE_MESSAGE = `This organization's report is too large to sync to a spreadsheet. One sync writes at most ${ORGANIZATION_SHEET_SYNC_MAX_ROWS.toLocaleString("en-US")} rows and ${ORGANIZATION_SHEET_SYNC_MAX_CELLS.toLocaleString("en-US")} cells. Choose a smaller report or fewer columns.`;

async function writeOrganizationReport(
  supabase: ReturnType<typeof getAdminClient>,
  config: OrganizationSheetSyncConfig,
  accessToken: string,
  signal?: AbortSignal,
): Promise<OrganizationSheetSyncResult> {
  // Every Sheets request below spends from this budget, so one sync can make
  // at most the metadata read, the write and the two clears.
  const sheets = {
    signal,
    budget: { remaining: ORGANIZATION_SHEET_SYNC_MAX_SHEETS_REQUESTS },
  };
  const timedOut = (): OrganizationSheetSyncResult => ({
    success: false,
    code: "sheets_timeout",
    error: TIMEOUT_MESSAGE,
  });
  const tabName =
    config.tab_name?.trim() || ORGANIZATION_SHEET_SYNC_DEFAULT_TAB;
  const reportType = config.report_type as ReportType;

  const inspection = await inspectSpreadsheet(
    accessToken,
    config.sheet_id,
    sheets,
  );
  if (!inspection.ok) {
    return { success: false, ...SHEETS_FAILURES[inspection.reason] };
  }
  if (!inspection.metadata.tabs.includes(tabName)) {
    return {
      success: false,
      code: "tab_missing",
      error: `The tab "${tabName}" no longer exists in the spreadsheet. Pick a tab again in the sheet settings.`,
    };
  }

  const withinBounds = await isReportSourceWithinBounds(
    supabase,
    config.organization_id,
  );
  if (signal?.aborted) return timedOut();
  if (withinBounds === null) {
    return {
      success: false,
      code: "report_unavailable",
      error:
        "The report size could not be checked. Try again in a few minutes.",
    };
  }
  if (!withinBounds) {
    return {
      success: false,
      code: "report_too_large",
      error: REPORT_TOO_LARGE_MESSAGE,
    };
  }

  const layout = resolveSavedSheetLayout(config.layout_config, reportType);
  if (config.layout_config && !layout) {
    logWarn("Saved sheet layout is not usable, using the default layout", {
      organization_id: config.organization_id,
    });
  }

  const { rows, error: rowsError } = await buildOrganizationReportRowsForSync(
    config.organization_id,
    reportType,
    undefined,
    layout ? (report) => buildSheetRowsWithLayout(report, layout) : undefined,
  );
  if (rowsError || !rows) {
    return {
      success: false,
      code: "report_unavailable",
      error: rowsError || "Failed to build report",
    };
  }

  // Building the report cannot be interrupted, so the deadline is checked
  // again before anything is written.
  if (signal?.aborted) return timedOut();

  // The second guard: the built report itself, whatever the counts said.
  const cellCount = rows.reduce((total, row) => total + row.length, 0);
  if (
    rows.length > ORGANIZATION_SHEET_SYNC_MAX_ROWS ||
    cellCount > ORGANIZATION_SHEET_SYNC_MAX_CELLS
  ) {
    return {
      success: false,
      code: "report_too_large",
      error: REPORT_TOO_LARGE_MESSAGE,
    };
  }

  // A sync saved with the old pre-filled range keeps growing from A1, as it
  // always did. Every other bounded range is a strict box.
  const writeRangeA1 = openLegacyDefaultReportRange(config.range_a1);
  const overflow = describeReportRangeOverflow(writeRangeA1, rows);
  if (overflow) {
    return { success: false, code: "range_too_small", error: overflow };
  }

  const replacement = await replaceSpreadsheetReportValues(
    accessToken,
    config.sheet_id,
    tabName,
    writeRangeA1,
    rows,
    sheets,
    // Stale cells are still cleared only inside the saved range.
    config.range_a1,
  );
  if (!replacement.success && replacement.stage === "write") {
    // The spreadsheet opened a moment ago, so a refusal here is about editing.
    if (replacement.reason === "access_denied") {
      return {
        success: false,
        code: "sheet_not_editable",
        error:
          "The connected Google account can view this spreadsheet but cannot edit it. Ask the file owner for edit access, or choose another file.",
      };
    }
    return { success: false, ...SHEETS_FAILURES[replacement.reason] };
  }
  if (!replacement.success) {
    return {
      success: false,
      code: "stale_clear_failed",
      error:
        "The sheet was updated, but older rows below or beside the report could not be cleared.",
    };
  }

  return { success: true };
}
