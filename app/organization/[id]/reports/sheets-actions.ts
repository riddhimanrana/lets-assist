"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getSheetsConnection,
  getGoogleAccessTokenForSheets,
  getGoogleAccessTokenForSheetsForUser,
  hasGoogleSheetsScopes,
} from "@/services/calendar";
import {
  buildSpreadsheetUrl,
  buildWriteRange,
  createSpreadsheet,
  ensureSpreadsheetTab,
  extractSpreadsheetId,
  getSpreadsheetMetadata,
  updateSpreadsheetValues,
} from "@/services/google-sheets";
import { buildOrganizationReportRows, type ReportType, getOrganizationReportData } from "./actions";
import {
  buildRowsWithLayout,
  validateLayout,
  type ReportLayoutConfig,
} from "./report-layouts";

export type SheetSyncStatus = {
  connected: boolean;
  connectedEmail?: string | null;
  scopesOk?: boolean;
  viewerConnected?: boolean;
  viewerScopesOk?: boolean;
  connectedBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  viewerIsOwner?: boolean;
  syncConfig?: {
    sheetId: string;
    sheetUrl: string;
    sheetTitle?: string | null;
    tabName: string;
    rangeA1?: string | null;
    reportType: ReportType;
    layoutConfig?: ReportLayoutConfig | null;
    autoSync: boolean;
    syncIntervalMinutes: number;
    lastSyncedAt?: string | null;
  } | null;
  error?: string;
};

const DEFAULT_TAB_NAME = "Member Hours";
const DEFAULT_SYNC_INTERVAL_MINUTES = 1440;
const DEFAULT_RANGE_A1 = "A1";
const MIN_SYNC_INTERVAL_MINUTES = 60;

function hasConfiguredSheetDestination(
  syncConfig:
    | {
        sheet_id?: string | null;
        sheet_url?: string | null;
        tab_name?: string | null;
        report_type?: string | null;
      }
    | null
    | undefined
) {
  return Boolean(
    syncConfig?.sheet_id?.trim() &&
      syncConfig?.sheet_url?.trim() &&
      syncConfig?.tab_name?.trim() &&
      syncConfig?.report_type?.trim()
  );
}

async function assertOrgAccess(organizationId: string) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) {
    return { error: "Authentication required", userId: null };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .single();

  const canView = membership?.role === "admin" || membership?.role === "staff";
  if (!canView) {
    return { error: "Permission denied", userId: null };
  }

  return { error: undefined, userId: authData.user.id, role: membership?.role };
}

export async function getSheetSyncStatus(
  organizationId: string
): Promise<SheetSyncStatus> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { connected: false, error: access.error ?? undefined };
  }

  const connection = await getSheetsConnection(access.userId);

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, sheet_url, sheet_title, tab_name, range_a1, report_type, layout_config, auto_sync, sync_interval_minutes, last_synced_at, created_by"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  const viewerConnected = !!connection;
  const viewerScopesOk = connection ? hasGoogleSheetsScopes(connection.granted_scopes) : false;
  
  let connectedBy: SheetSyncStatus["connectedBy"] = null;
  let connected = !!connection;
  let connectedEmail = connection?.calendar_email || null;
  let scopesOk = connection ? hasGoogleSheetsScopes(connection.granted_scopes) : false;
  const viewerIsOwner = syncConfig?.created_by
    ? syncConfig.created_by === access.userId
    : false;
  const destinationConfigured = hasConfiguredSheetDestination(syncConfig);

  if (syncConfig?.created_by) {
    const { data: ownerConnection } = await serviceSupabase
      .from("user_calendar_connections")
      .select("granted_scopes, calendar_email")
      .eq("user_id", syncConfig.created_by)
      .eq("provider", "google")
      .eq("is_active", true)
      .maybeSingle();

    connected = !!ownerConnection;
    connectedEmail = ownerConnection?.calendar_email || null;
    scopesOk = hasGoogleSheetsScopes(ownerConnection?.granted_scopes);

    const { data: ownerProfile } = await serviceSupabase
      .from("profiles")
      .select("id, full_name, username, email")
      .eq("id", syncConfig.created_by)
      .maybeSingle();

    connectedBy = {
      id: syncConfig.created_by,
      name: ownerProfile?.full_name || ownerProfile?.username || null,
      email: ownerProfile?.email || ownerConnection?.calendar_email || null,
    };
  }

  if (syncError) {
    console.error("Failed to load sheet sync config:", syncError);
    return {
      connected,
      connectedEmail,
      scopesOk,
      viewerConnected,
      viewerScopesOk,
      connectedBy,
      viewerIsOwner,
      error: "Sheets sync configuration not available",
    };
  }

  return {
    connected,
    connectedEmail,
    scopesOk,
    viewerConnected,
    viewerScopesOk,
    connectedBy,
    viewerIsOwner,
    syncConfig: syncConfig
      ? destinationConfigured
      ? {
          sheetId: syncConfig.sheet_id,
          sheetUrl: syncConfig.sheet_url,
          sheetTitle: syncConfig.sheet_title,
          tabName: syncConfig.tab_name,
          rangeA1: syncConfig.range_a1,
          reportType: syncConfig.report_type as ReportType,
          layoutConfig: syncConfig.layout_config ?? null,
          autoSync: syncConfig.auto_sync,
          syncIntervalMinutes: syncConfig.sync_interval_minutes,
          lastSyncedAt: syncConfig.last_synced_at,
        }
      : null
      : null,
  };
}

export async function createSheetSync(
  organizationId: string,
  reportType: ReportType = "member-hours",
  tabName: string = DEFAULT_TAB_NAME,
  rangeA1: string = DEFAULT_RANGE_A1,
  layoutConfig?: ReportLayoutConfig | null
): Promise<{ success: boolean; error?: string; sheetUrl?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const connection = await getSheetsConnection(access.userId);
  if (!connection) {
    return { success: false, error: "Google connection required" };
  }

  if (!hasGoogleSheetsScopes(connection.granted_scopes)) {
    return {
      success: false,
      error: "Google connection needs Sheets access. Reconnect with Sheets permissions.",
    };
  }

  if (layoutConfig) {
    if (layoutConfig.reportType !== reportType) {
      return { success: false, error: "Layout report type does not match selection." };
    }
    const validation = validateLayout(layoutConfig);
    if (!validation.valid) {
      return { success: false, error: `Invalid layout: ${validation.errors.join("; ")}` };
    }
  }

  const accessToken = await getGoogleAccessTokenForSheets(access.userId);
  if (!accessToken) {
    return {
      success: false,
      error: "Google connection needs Sheets access. Reconnect with Sheets permissions.",
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
      { onConflict: "organization_id" }
    );

  if (upsertError) {
    console.error("Failed to save sheet sync config:", upsertError);
    return { success: false, error: "Failed to save sheet configuration" };
  }

  const syncResult = await syncSheetNow(organizationId);
  if (!syncResult.success) {
    return {
      success: false,
      error: syncResult.error || "Sheet created, but initial sync failed. Please reconnect and try syncing again.",
      sheetUrl: sheet.sheetUrl,
    };
  }

  return { success: true, sheetUrl: sheet.sheetUrl };
}

export async function syncSheetNow(
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error ?? undefined };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, tab_name, range_a1, report_type, layout_config, sheet_url, sync_interval_minutes, created_by"
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

  const accessToken = await getGoogleAccessTokenForSheetsForUser(
    syncConfig.created_by,
    true
  );
  if (!accessToken) {
    return {
      success: false,
      error: "Sheets access missing. Ask an admin to reconnect with Sheets permissions.",
    };
  }

  const ensured = await ensureSpreadsheetTab(
    accessToken,
    syncConfig.sheet_id,
    syncConfig.tab_name || DEFAULT_TAB_NAME
  );
  if (!ensured) {
    return { success: false, error: "Unable to access the selected sheet tab." };
  }

  const { rows: defaultRows, error: rowsError } = await buildOrganizationReportRows(
    organizationId,
    syncConfig.report_type as ReportType
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
        layoutConfig = syncConfig.layout_config as unknown as ReportLayoutConfig;
      }

      if (layoutConfig.reportType !== (syncConfig.report_type as ReportType)) {
        throw new Error("Layout report type mismatch");
      }

      const { data: reportData } = await getOrganizationReportData(organizationId);
      if (reportData) {
        rows = buildRowsWithLayout(reportData, layoutConfig);
      }
    } catch (error) {
      console.warn("Failed to apply custom layout, using default:", error);
      // Fall back to default rows
    }
  }

  const range = buildWriteRange(
    syncConfig.tab_name || DEFAULT_TAB_NAME,
    syncConfig.range_a1,
    rows
  );
  const updated = await updateSpreadsheetValues(
    accessToken,
    syncConfig.sheet_id,
    range,
    rows
  );

  if (!updated) {
    return { success: false, error: "Failed to update Google Sheet" };
  }

  await serviceSupabase
    .from("organization_sheet_syncs")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  return { success: true };
}

export async function updateSheetSyncSettings(
  organizationId: string,
  updates: { autoSync?: boolean; syncIntervalMinutes?: number }
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
      return { success: false, error: "Sync interval must be a whole number of minutes" };
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
  }
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
    if (updates.reportType && updates.layoutConfig.reportType !== updates.reportType) {
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

export async function getSheetsAccessTokenForPicker(
  organizationId: string
): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const connection = await getSheetsConnection(access.userId);
  if (!connection) {
    return { success: false, error: "Google connection required" };
  }

  if (!hasGoogleSheetsScopes(connection.granted_scopes)) {
    return {
      success: false,
      error: "Sheets permissions are missing. Reconnect with Sheets access to continue.",
    };
  }

  const accessToken = await getGoogleAccessTokenForSheets(access.userId);
  if (!accessToken) {
    return {
      success: false,
      error: "Sheets permissions are missing. Reconnect with Sheets access to continue.",
    };
  }

  return { success: true, accessToken };
}

export async function getSpreadsheetSetupMetadata(
  organizationId: string,
  sheetInput: string
): Promise<{
  success: boolean;
  metadata?: { sheetId: string; sheetTitle: string; tabs: string[]; sheetUrl: string };
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

  const accessToken = await getGoogleAccessTokenForSheets(access.userId);
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
  }
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const accessToken = await getGoogleAccessTokenForSheets(access.userId);
  if (!accessToken) {
    return { success: false, error: "Sheets permissions missing" };
  }

  if (params.layoutConfig) {
    if (params.layoutConfig.reportType !== params.reportType) {
      return { success: false, error: "Layout report type does not match selection." };
    }
    const validation = validateLayout(params.layoutConfig);
    if (!validation.valid) {
      return { success: false, error: `Invalid layout: ${validation.errors.join("; ")}` };
    }
  }

  const metadata = await getSpreadsheetMetadata(accessToken, params.sheetId);
  if (!metadata) {
    return { success: false, error: "Unable to access spreadsheet" };
  }

  const ensured = await ensureSpreadsheetTab(
    accessToken,
    params.sheetId,
    params.tabName || DEFAULT_TAB_NAME
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
      { onConflict: "organization_id" }
    );

  if (upsertError) {
    console.error("Failed to save sheet sync config:", upsertError);
    return { success: false, error: "Failed to save sheet configuration" };
  }

  const syncResult = await syncSheetNow(organizationId);
  if (!syncResult.success) {
    return {
      success: false,
      error: syncResult.error || "Sheet connected, but initial sync failed. Please reconnect and try syncing again.",
    };
  }

  return { success: true };
}

export async function getSheetReportPreview(
  organizationId: string,
  reportType: ReportType,
  limit = 12,
  layoutConfig?: ReportLayoutConfig | null
): Promise<{ success: boolean; rows?: string[][]; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (layoutConfig && layoutConfig.reportType === reportType) {
    const validation = validateLayout(layoutConfig);
    if (!validation.valid) {
      return { success: false, error: `Invalid layout: ${validation.errors.join("; ")}` };
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

  const { rows, error } = await buildOrganizationReportRows(organizationId, reportType);

  if (error || !rows) {
    return { success: false, error: error || "Failed to build preview" };
  }

  return {
    success: true,
    rows: rows.slice(0, Math.min(rows.length, limit)),
  };
}

export async function unlinkSheetSync(
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { error } = await serviceSupabase
    .from("organization_sheet_syncs")
    .delete()
    .eq("organization_id", organizationId);

  if (error) {
    console.error("Failed to unlink sheet sync:", error);
    return { success: false, error: "Failed to unlink sheet" };
  }

  return { success: true };
}

export async function getAvailableSheetOwners(
  organizationId: string
): Promise<
  | { success: false; error: string }
  | {
      success: true;
      owners: Array<{
        id: string;
        name: string | null;
        email: string | null;
        role: string | null;
        connectedEmail: string | null;
        hasSheetsAccess: boolean;
      }>;
    }
> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error || "Authentication required" };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: members, error } = await serviceSupabase
    .from("organization_members")
    .select("user_id, role, profiles(id, full_name, username, email)")
    .eq("organization_id", organizationId);

  if (error || !members) {
    console.error("Failed to load organization members:", error);
    return { success: false, error: "Failed to load organization members" };
  }

  const eligibleMembers = (members.filter(
    (member) => member.role === "admin" || member.role === "staff"
  ) as unknown) as Array<{
    user_id: string;
    role: string;
    profiles: { id: string; full_name: string | null; username: string | null; email: string | null } | null;
  }>;
  const memberIds = eligibleMembers.map((member) => member.user_id).filter(Boolean);
  if (memberIds.length === 0) {
    return { success: true, owners: [] };
  }

  const { data: connections } = await serviceSupabase
    .from("user_calendar_connections")
    .select("user_id, calendar_email, granted_scopes")
    .eq("provider", "google")
    .eq("is_active", true)
    .in("user_id", memberIds);

  const connectionMap = new Map(
    (connections || []).map((connection) => [connection.user_id, connection])
  );

  const owners = eligibleMembers
    .map((member) => {
      const profile = member.profiles;
      const connection = connectionMap.get(member.user_id);
      const hasSheetsAccess = hasGoogleSheetsScopes(connection?.granted_scopes || null);
      return {
        id: member.user_id,
        name: profile?.full_name || profile?.username || null,
        email: profile?.email || null,
        role: member.role,
        connectedEmail: connection?.calendar_email || null,
        hasSheetsAccess,
      };
    })
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1));

  return { success: true, owners };
}

export async function updateSheetOwner(
  organizationId: string,
  ownerId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!syncConfig) {
    return { success: false, error: "Sheets sync is not configured" };
  }

  const { data: ownerConnection } = await serviceSupabase
    .from("user_calendar_connections")
    .select("granted_scopes")
    .eq("user_id", ownerId)
    .eq("provider", "google")
    .eq("is_active", true)
    .maybeSingle();

  if (!hasGoogleSheetsScopes(ownerConnection?.granted_scopes || null)) {
    return {
      success: false,
      error: "Selected owner must reconnect with Sheets permissions",
    };
  }

  const { error } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({ created_by: ownerId, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  if (error) {
    console.error("Failed to update sheet owner:", error);
    return { success: false, error: "Failed to update sheet owner" };
  }

  return { success: true };
}