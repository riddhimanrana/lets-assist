"use server";

import { getAdminClient } from "@/lib/supabase/admin";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import { hasGoogleSheetsScopes } from "@/services/calendar";
import {
  createSpreadsheet,
  ensureSpreadsheetTab,
  replaceSpreadsheetReportValues,
} from "@/services/google-sheets";
import { buildOrganizationReportRows } from "@/lib/organization/report-service";
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
  hasConfiguredSheetDestination,
  MIN_SYNC_INTERVAL_MINUTES,
} from "./shared";

export async function createSheetSync(
  organizationId: string,
  reportType: ReportType = "member-hours",
  tabName: string = DEFAULT_TAB_NAME,
  rangeA1: string = DEFAULT_RANGE_A1,
  layoutConfig?: ReportLayoutConfig | null,
): Promise<{ success: boolean; error?: string; sheetUrl?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
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
        "Google connection needs Sheets access. Reconnect with Sheets permissions.",
    };
  }

  if (layoutConfig) {
    if (layoutConfig.reportType !== reportType) {
      return {
        success: false,
        error: "Layout report type does not match selection.",
      };
    }
    const validation = validateLayout(layoutConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid layout: ${validation.errors.join("; ")}`,
      };
    }
  }

  const accessToken = await getOrganizationSheetsAccessToken(
    access.userId,
    organizationId,
  );
  if (!accessToken) {
    return {
      success: false,
      error:
        "Google connection needs Sheets access. Reconnect with Sheets permissions.",
    };
  }

  const serviceSupabase = getAdminClient();
  const { data: orgData } = await serviceSupabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  const sheetTitle = orgData?.name
    ? `Let's Assist - ${orgData.name} Reports`
    : "Let's Assist Organization Reports";

  const sheet = await createSpreadsheet(accessToken, sheetTitle, tabName);
  if (!sheet) {
    return { success: false, error: "Failed to create Google Sheet" };
  }

  const { error: upsertError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .upsert(
      {
        organization_id: organizationId,
        created_by: access.userId,
        sheet_id: sheet.sheetId,
        sheet_url: sheet.sheetUrl,
        sheet_title: sheet.sheetTitle,
        tab_name: sheet.tabName,
        range_a1: rangeA1,
        report_type: reportType,
        layout_config: layoutConfig ?? null,
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
        "Sheet created, but initial sync failed. Please reconnect and try syncing again.",
      sheetUrl: sheet.sheetUrl,
    };
  }

  return { success: true, sheetUrl: sheet.sheetUrl };
}

export async function syncSheetNow(
  organizationId: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, tab_name, range_a1, report_type, layout_config, sheet_url, sync_interval_minutes, created_by",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (syncError || !syncConfig) {
    return { success: false, error: "Sheet sync not configured" };
  }

  if (!hasConfiguredSheetDestination(syncConfig)) {
    return {
      success: false,
      error: "No sheet destination is configured yet. Complete setup below.",
    };
  }

  if (!syncConfig.created_by) {
    return { success: false, error: "Sheet sync owner not found" };
  }

  const ownerAuthorization = await authorizeGoogleOAuthOrganizationRequest({
    userId: syncConfig.created_by,
    organizationId,
    pluginKey: null,
    purpose: "organization_sheets",
    requestedCapability: null,
  });
  if (!ownerAuthorization.allowed) {
    await serviceSupabase
      .from("organization_sheet_syncs")
      .update({ auto_sync: false, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);
    return {
      success: false,
      error: "Sheet sync owner no longer has active organization admin access",
    };
  }

  const accessToken = await getOrganizationSheetsAccessToken(
    syncConfig.created_by,
    organizationId,
    true,
  );
  if (!accessToken) {
    return {
      success: false,
      error:
        "Sheets access missing. Ask an admin to reconnect with Sheets permissions.",
    };
  }

  const ensured = await ensureSpreadsheetTab(
    accessToken,
    syncConfig.sheet_id,
    syncConfig.tab_name || DEFAULT_TAB_NAME,
  );
  if (!ensured) {
    return {
      success: false,
      error: "Unable to access the selected sheet tab.",
    };
  }

  const { rows: defaultRows, error: rowsError } =
    await buildOrganizationReportRows(
      organizationId,
      syncConfig.report_type as ReportType,
    );

  if (rowsError || !defaultRows) {
    return { success: false, error: rowsError || "Failed to build report" };
  }

  // Use custom layout if configured, otherwise use default
  let rows = defaultRows;
  if (syncConfig.layout_config) {
    try {
      let layoutConfig: ReportLayoutConfig;
      if (typeof syncConfig.layout_config === "string") {
        layoutConfig = JSON.parse(syncConfig.layout_config);
      } else {
        layoutConfig =
          syncConfig.layout_config as unknown as ReportLayoutConfig;
      }

      if (layoutConfig.reportType !== (syncConfig.report_type as ReportType)) {
        throw new Error("Layout report type mismatch");
      }

      const { data: reportData } =
        await getOrganizationReportData(organizationId);
      if (reportData) {
        rows = buildRowsWithLayout(reportData, layoutConfig);
      }
    } catch (error) {
      console.warn("Failed to apply custom layout, using default:", error);
      // Fall back to default rows
    }
  }

  const replacement = await replaceSpreadsheetReportValues(
    accessToken,
    syncConfig.sheet_id,
    syncConfig.tab_name || DEFAULT_TAB_NAME,
    syncConfig.range_a1,
    rows,
  );

  if (!replacement.success && replacement.stage === "write") {
    return { success: false, error: "Failed to update Google Sheet" };
  }

  if (!replacement.success) {
    return {
      success: false,
      error: "Google Sheet updated, but stale values could not be cleared",
    };
  }

  await serviceSupabase
    .from("organization_sheet_syncs")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  return { success: true };
}

export async function updateSheetSyncSettings(
  organizationId: string,
  updates: { autoSync?: boolean; syncIntervalMinutes?: number },
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  if (updates.syncIntervalMinutes !== undefined) {
    if (!Number.isInteger(updates.syncIntervalMinutes)) {
      return {
        success: false,
        error: "Sync interval must be a whole number of minutes",
      };
    }

    if (updates.syncIntervalMinutes < MIN_SYNC_INTERVAL_MINUTES) {
      return {
        success: false,
        error: `Sync interval must be at least ${MIN_SYNC_INTERVAL_MINUTES} minutes`,
      };
    }
  }

  const serviceSupabase = getAdminClient();

  const { data: existingSync } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existingSync) {
    return { success: false, error: "Sheet sync not configured" };
  }

  const updatePayload: {
    auto_sync?: boolean;
    sync_interval_minutes?: number;
    updated_at: string;
  } = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.autoSync === "boolean") {
    updatePayload.auto_sync = updates.autoSync;
  }

  if (updates.syncIntervalMinutes !== undefined) {
    updatePayload.sync_interval_minutes = updates.syncIntervalMinutes;
  }

  const { error: updateError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update(updatePayload)
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("Failed to update sheet sync settings:", updateError);
    return { success: false, error: "Failed to update sync settings" };
  }

  return { success: true };
}

export async function updateSheetSyncConfig(
  organizationId: string,
  updates: {
    reportType?: ReportType;
    tabName?: string;
    rangeA1?: string;
    layoutConfig?: ReportLayoutConfig | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: existingSync } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existingSync) {
    return { success: false, error: "Sheet sync not configured" };
  }

  // Validate layout if provided
  if (updates.layoutConfig) {
    if (
      updates.reportType &&
      updates.layoutConfig.reportType !== updates.reportType
    ) {
      return {
        success: false,
        error: "Layout report type does not match selection.",
      };
    }
    const validation = validateLayout(updates.layoutConfig);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid layout: ${validation.errors.join("; ")}`,
      };
    }
  }

  const { error: updateError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({
      report_type: updates.reportType,
      tab_name: updates.tabName,
      range_a1: updates.rangeA1,
      layout_config: updates.layoutConfig,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("Failed to update sheet sync config:", updateError);
    return { success: false, error: "Failed to update sheet config" };
  }

  return { success: true };
}
