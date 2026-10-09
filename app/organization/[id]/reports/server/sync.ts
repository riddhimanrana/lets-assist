"use server";
import { safeConsole } from "@/lib/safe-console";

import { getAdminClient } from "@/lib/supabase/admin";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import { hasGoogleSheetsScopes } from "@/services/calendar";
import {
  createSpreadsheet,
  ensureSpreadsheetTab,
} from "@/services/google-sheets";
import {
  ORGANIZATION_SHEET_SYNC_COLUMNS,
  runOrganizationSheetSync,
  type OrganizationSheetSyncErrorCode,
} from "@/lib/google-sheets/organization-report-sync";
import type { ReportType } from "../actions";
import { validateLayout, type ReportLayoutConfig } from "../report-layouts";
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
    safeConsole.error("Failed to save sheet sync config:", upsertError);
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

export async function syncSheetNow(organizationId: string): Promise<{
  success: boolean;
  error?: string;
  /** Lets the cards offer the matching fix, such as choosing the file again. */
  code?: OrganizationSheetSyncErrorCode;
}> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(`${ORGANIZATION_SHEET_SYNC_COLUMNS}, sheet_url, created_by`)
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

  // The same function the scheduled worker runs, so the saved layout, the
  // range check and the tab check cannot drift between the two paths.
  return runOrganizationSheetSync({
    supabase: serviceSupabase,
    config: syncConfig,
    accessToken,
  });
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
    safeConsole.error("Failed to update sheet sync settings:", updateError);
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
    .select("organization_id, sheet_id, tab_name, created_by")
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

  // A sync never creates a tab, so a tab an admin names here is created now,
  // while it is still their explicit choice.
  const nextTabName = updates.tabName?.trim();
  if (
    nextTabName &&
    nextTabName !== existingSync.tab_name &&
    existingSync.sheet_id &&
    existingSync.created_by
  ) {
    const ownerToken = await getOrganizationSheetsAccessToken(
      existingSync.created_by,
      organizationId,
      true,
    );
    if (
      ownerToken &&
      !(await ensureSpreadsheetTab(
        ownerToken,
        existingSync.sheet_id,
        nextTabName,
      ))
    ) {
      return {
        success: false,
        error: `Unable to open or create the tab "${nextTabName}". Check that the connected Google account can edit the spreadsheet.`,
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
    safeConsole.error("Failed to update sheet sync config:", updateError);
    return { success: false, error: "Failed to update sheet config" };
  }

  return { success: true };
}
