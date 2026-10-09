"use server";
import { safeConsole } from "@/lib/safe-console";

import {
  createGooglePickerAccessTokenResult,
  resolveGooglePickerAppId,
  type GooglePickerAccessTokenResult,
} from "@/lib/auth/google-picker-config";
import { getAdminClient } from "@/lib/supabase/admin";
import { buildOrganizationReportRows } from "@/lib/organization/report-service";
import {
  buildSpreadsheetUrl,
  ensureSpreadsheetTab,
  extractSpreadsheetId,
  getSpreadsheetMetadata,
} from "@/services/google-sheets";
import { inspectSpreadsheet } from "@/services/google-sheets-report";
import { hasGoogleSheetsScopes } from "@/services/calendar";
import { getOrganizationReportData, type ReportType } from "../actions";
import {
  buildRowsWithLayout,
  validateLayout,
  type ReportLayoutConfig,
} from "../report-layouts";
import {
  assertOrgAccess,
  DEFAULT_RANGE_A1,
  DEFAULT_SYNC_INTERVAL_MINUTES,
  DEFAULT_TAB_NAME,
  getOrganizationSheetsAccessToken,
  getOrganizationSheetsConnection,
} from "./shared";
import { syncSheetNow } from "./sync";

// The app holds the drive.file scope: it can open a spreadsheet only after the
// connected person picks it in the Google picker, or after the app creates it.
const PICKER_REQUIRED_MESSAGE =
  "Let's Assist can only open spreadsheets you choose with the picker. Use Choose from Google Drive to select this file.";

function describeInspectionFailure(reason: string) {
  if (reason === "access_denied" || reason === "not_found") {
    return PICKER_REQUIRED_MESSAGE;
  }
  if (reason === "timeout") {
    return "Google Sheets did not respond in time. Try again in a few minutes.";
  }
  return "Google Sheets returned an error. Try again in a few minutes.";
}

export async function getSheetsAccessTokenForPicker(
  organizationId: string,
): Promise<GooglePickerAccessTokenResult> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return {
      success: false,
      error: access.error || "Authentication required",
    };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const connection = await getOrganizationSheetsConnection(
    access.userId,
    organizationId,
  );
  if (!connection) {
    return { success: false, error: "Google connection required" };
  }

  if (!hasGoogleSheetsScopes(connection.granted_scopes)) {
    return {
      success: false,
      error:
        "Sheets permissions are missing. Reconnect with Sheets access to continue.",
    };
  }

  const appIdResult = resolveGooglePickerAppId();
  if (!appIdResult.success) return appIdResult;

  const accessToken = await getOrganizationSheetsAccessToken(
    access.userId,
    organizationId,
  );
  if (!accessToken) {
    return {
      success: false,
      error:
        "Sheets permissions are missing. Reconnect with Sheets access to continue.",
    };
  }

  return createGooglePickerAccessTokenResult(
    accessToken,
    appIdResult.pickerAppId,
  );
}

export async function getSpreadsheetSetupMetadata(
  organizationId: string,
  sheetInput: string,
): Promise<{
  success: boolean;
  metadata?: {
    sheetId: string;
    sheetTitle: string;
    tabs: string[];
    sheetUrl: string;
  };
  error?: string;
}> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const sheetId = extractSpreadsheetId(sheetInput);
  if (!sheetId) {
    return { success: false, error: "Invalid spreadsheet URL or ID" };
  }

  const accessToken = await getOrganizationSheetsAccessToken(
    access.userId,
    organizationId,
  );
  if (!accessToken) {
    return { success: false, error: "Sheets permissions missing" };
  }

  const inspection = await inspectSpreadsheet(accessToken, sheetId);
  if (!inspection.ok) {
    return {
      success: false,
      error: describeInspectionFailure(inspection.reason),
    };
  }

  const { metadata } = inspection;
  return {
    success: true,
    metadata: {
      sheetId: metadata.sheetId,
      sheetTitle: metadata.sheetTitle,
      tabs: metadata.tabs,
      sheetUrl: buildSpreadsheetUrl(metadata.sheetId),
    },
  };
}

/**
 * Points the existing sync at a spreadsheet the admin just picked, keeping the
 * tab, range, layout and schedule. The admin who picks the file becomes the
 * sync owner, because Google grants access to the account that picked it.
 */
export async function reselectSheetDestination(
  organizationId: string,
  sheetInput: string,
): Promise<{
  success: boolean;
  error?: string;
  /** Automatic sync is off, usually because the file could not be opened. */
  autoSyncOff?: boolean;
}> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const sheetId = extractSpreadsheetId(sheetInput);
  if (!sheetId) {
    return { success: false, error: "Invalid spreadsheet URL or ID" };
  }

  const accessToken = await getOrganizationSheetsAccessToken(
    access.userId,
    organizationId,
  );
  if (!accessToken) {
    return {
      success: false,
      error:
        "Connect your Google account with Sheets access, then choose the file again.",
    };
  }

  const inspection = await inspectSpreadsheet(accessToken, sheetId);
  if (!inspection.ok) {
    return {
      success: false,
      error: describeInspectionFailure(inspection.reason),
    };
  }

  const serviceSupabase = getAdminClient();
  const { data: updated, error: updateError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({
      created_by: access.userId,
      sheet_id: inspection.metadata.sheetId,
      sheet_url: buildSpreadsheetUrl(inspection.metadata.sheetId),
      sheet_title: inspection.metadata.sheetTitle,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .select("organization_id, auto_sync");

  if (updateError) {
    safeConsole.error("Failed to reselect sheet destination:", updateError);
    return { success: false, error: "Failed to save the selected spreadsheet" };
  }
  if (!updated?.length) {
    return { success: false, error: "Sheet sync not configured" };
  }

  const syncResult = await syncSheetNow(organizationId);
  return syncResult.success
    ? { success: true, autoSyncOff: !updated[0].auto_sync }
    : {
        success: false,
        error: syncResult.error || "Spreadsheet selected, but the sync failed.",
      };
}

export async function connectExistingSheet(
  organizationId: string,
  params: {
    sheetId: string;
    reportType: ReportType;
    tabName: string;
    rangeA1?: string;
    layoutConfig?: ReportLayoutConfig | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const accessToken = await getOrganizationSheetsAccessToken(
    access.userId,
    organizationId,
  );
  if (!accessToken) {
    return { success: false, error: "Sheets permissions missing" };
  }

  if (params.layoutConfig) {
    if (params.layoutConfig.reportType !== params.reportType) {
      return {
        success: false,
        error: "Layout report type does not match selection.",
      };
    }
    const validation = validateLayout(params.layoutConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid layout: ${validation.errors.join("; ")}`,
      };
    }
  }

  const metadata = await getSpreadsheetMetadata(accessToken, params.sheetId);
  if (!metadata) {
    return { success: false, error: PICKER_REQUIRED_MESSAGE };
  }

  const ensured = await ensureSpreadsheetTab(
    accessToken,
    params.sheetId,
    params.tabName || DEFAULT_TAB_NAME,
  );
  if (!ensured) {
    return { success: false, error: "Unable to create or access the tab" };
  }

  const serviceSupabase = getAdminClient();
  const { error: upsertError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .upsert(
      {
        organization_id: organizationId,
        created_by: access.userId,
        sheet_id: metadata.sheetId,
        sheet_url: buildSpreadsheetUrl(metadata.sheetId),
        sheet_title: metadata.sheetTitle,
        tab_name: params.tabName || DEFAULT_TAB_NAME,
        range_a1: params.rangeA1 || DEFAULT_RANGE_A1,
        report_type: params.reportType,
        layout_config: params.layoutConfig ?? null,
        auto_sync: false,
        sync_interval_minutes: DEFAULT_SYNC_INTERVAL_MINUTES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

  if (upsertError) {
    safeConsole.error("Failed to save sheet sync config:", upsertError);
    return { success: false, error: "Failed to save sheet configuration" };
  }

  const syncResult = await syncSheetNow(organizationId);
  if (!syncResult.success) {
    return {
      success: false,
      error:
        syncResult.error ||
        "Sheet connected, but initial sync failed. Please reconnect and try syncing again.",
    };
  }

  return { success: true };
}

export async function getSheetReportPreview(
  organizationId: string,
  reportType: ReportType,
  limit = 12,
  layoutConfig?: ReportLayoutConfig | null,
): Promise<{ success: boolean; rows?: string[][]; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (layoutConfig && layoutConfig.reportType === reportType) {
    const validation = validateLayout(layoutConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid layout: ${validation.errors.join("; ")}`,
      };
    }

    const report = await getOrganizationReportData(organizationId);
    if (report.error || !report.data) {
      return { success: false, error: report.error || "Report unavailable" };
    }

    const rows = buildRowsWithLayout(report.data, layoutConfig);
    return {
      success: true,
      rows: rows.slice(0, Math.min(rows.length, limit)),
    };
  }

  const { rows, error } = await buildOrganizationReportRows(
    organizationId,
    reportType,
  );

  if (error || !rows) {
    return { success: false, error: error || "Failed to build preview" };
  }

  return {
    success: true,
    rows: rows.slice(0, Math.min(rows.length, limit)),
  };
}
