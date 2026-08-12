"use server";

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

  const metadata = await getSpreadsheetMetadata(accessToken, sheetId);
  if (!metadata) {
    return { success: false, error: "Unable to access spreadsheet" };
  }

  return {
    success: true,
    metadata: {
      ...metadata,
      sheetUrl: buildSpreadsheetUrl(metadata.sheetId),
    },
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
    return { success: false, error: "Unable to access spreadsheet" };
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
    console.error("Failed to save sheet sync config:", upsertError);
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
