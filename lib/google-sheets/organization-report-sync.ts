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

import { describeReportRangeOverflow } from "./ranges";

export const ORGANIZATION_SHEET_SYNC_DEFAULT_TAB = "Member Hours";

/**
 * The columns one sync needs. Both the manual action and the scheduled worker
 * select this list, so neither can leave out the saved layout.
 */
export const ORGANIZATION_SHEET_SYNC_COLUMNS =
  "organization_id, sheet_id, tab_name, range_a1, report_type, layout_config" as const;

export type OrganizationSheetSyncConfig = {
  organization_id: string;
  sheet_id: string;
  tab_name: string | null;
  range_a1: string | null;
  report_type: string;
  layout_config: unknown;
};

/** Stable codes for logs, the worker response and the cards. */
export type OrganizationSheetSyncErrorCode =
  | "sheet_inaccessible"
  | "sheet_not_editable"
  | "tab_missing"
  | "range_too_small"
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

const RESELECT_MESSAGE =
  "The connected Google account cannot open this spreadsheet. Choose the file again with the picker.";

const SHEETS_FAILURES: Record<
  SheetsFailureReason,
  { code: OrganizationSheetSyncErrorCode; error: string }
> = {
  access_denied: { code: "sheet_inaccessible", error: RESELECT_MESSAGE },
  not_found: { code: "sheet_inaccessible", error: RESELECT_MESSAGE },
  timeout: {
    code: "sheets_timeout",
    error: "Google Sheets did not respond in time. Try again in a few minutes.",
  },
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
}: {
  supabase: ReturnType<typeof getAdminClient>;
  config: OrganizationSheetSyncConfig;
  accessToken: string;
}): Promise<OrganizationSheetSyncResult> {
  const result = await writeOrganizationReport(config, accessToken);

  if (!result.success) {
    if (isPermanentSheetSyncFailure(result.code)) {
      await supabase
        .from("organization_sheet_syncs")
        .update({ auto_sync: false, updated_at: new Date().toISOString() })
        .eq("organization_id", config.organization_id);
    }
    return result;
  }

  const { error: recordError } = await supabase
    .from("organization_sheet_syncs")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", config.organization_id);
  if (recordError) {
    return {
      success: false,
      code: "record_failed",
      error: "The sheet was updated, but the sync time could not be saved.",
    };
  }

  return { success: true };
}

async function writeOrganizationReport(
  config: OrganizationSheetSyncConfig,
  accessToken: string,
): Promise<OrganizationSheetSyncResult> {
  const tabName =
    config.tab_name?.trim() || ORGANIZATION_SHEET_SYNC_DEFAULT_TAB;
  const reportType = config.report_type as ReportType;

  const inspection = await inspectSpreadsheet(accessToken, config.sheet_id);
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

  const overflow = describeReportRangeOverflow(config.range_a1, rows);
  if (overflow) {
    return { success: false, code: "range_too_small", error: overflow };
  }

  const replacement = await replaceSpreadsheetReportValues(
    accessToken,
    config.sheet_id,
    tabName,
    config.range_a1,
    rows,
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
