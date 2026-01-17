"use server";

import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import {
  getCalendarConnection,
  getGoogleAccessTokenForSheets,
  getGoogleAccessTokenForSheetsForUser,
  hasGoogleSheetsScopes,
} from "@/services/calendar";
import { createSpreadsheet, updateSpreadsheetValues } from "@/services/google-sheets";
import { buildOrganizationReportRows, type ReportType } from "./actions";

export type SheetSyncStatus = {
  connected: boolean;
  connectedEmail?: string | null;
  scopesOk?: boolean;
  connectedBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  viewerIsOwner?: boolean;
  syncConfig?: {
    sheetId: string;
    sheetUrl: string;
    tabName: string;
    reportType: ReportType;
    autoSync: boolean;
    syncIntervalMinutes: number;
    lastSyncedAt?: string | null;
  } | null;
  error?: string;
};

const DEFAULT_TAB_NAME = "Member Hours";
const DEFAULT_SYNC_INTERVAL_MINUTES = 1440;

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

  return { error: null, userId: authData.user.id, role: membership?.role };
}

export async function getSheetSyncStatus(
  organizationId: string
): Promise<SheetSyncStatus> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { connected: false, error: access.error };
  }

  const connection = await getCalendarConnection(access.userId);

  const serviceSupabase = getServiceRoleClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, sheet_url, tab_name, report_type, auto_sync, sync_interval_minutes, last_synced_at, created_by"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  let connectedBy: SheetSyncStatus["connectedBy"] = null;
  let connected = !!connection;
  let connectedEmail = connection?.calendar_email || null;
  let scopesOk = connection ? hasGoogleSheetsScopes(connection.granted_scopes) : false;
  const viewerIsOwner = syncConfig?.created_by
    ? syncConfig.created_by === access.userId
    : false;

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
      connectedBy,
      viewerIsOwner,
      error: "Sheets sync configuration not available",
    };
  }

  return {
    connected,
    connectedEmail,
    scopesOk,
    connectedBy,
    viewerIsOwner,
    syncConfig: syncConfig
      ? {
          sheetId: syncConfig.sheet_id,
          sheetUrl: syncConfig.sheet_url,
          tabName: syncConfig.tab_name,
          reportType: syncConfig.report_type as ReportType,
          autoSync: syncConfig.auto_sync,
          syncIntervalMinutes: syncConfig.sync_interval_minutes,
          lastSyncedAt: syncConfig.last_synced_at,
        }
      : null,
  };
}

export async function createSheetSync(
  organizationId: string,
  reportType: ReportType = "member-hours",
  tabName: string = DEFAULT_TAB_NAME
): Promise<{ success: boolean; error?: string; sheetUrl?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const connection = await getCalendarConnection(access.userId);
  if (!connection) {
    return { success: false, error: "Google connection required" };
  }

  if (!hasGoogleSheetsScopes(connection.granted_scopes)) {
    return {
      success: false,
      error: "Google connection needs Sheets access. Reconnect with Sheets permissions.",
    };
  }

  const accessToken = await getGoogleAccessTokenForSheets(access.userId);
  if (!accessToken) {
    return {
      success: false,
      error: "Google connection needs Sheets access. Reconnect with Sheets permissions.",
    };
  }

  const serviceSupabase = getServiceRoleClient();
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
        tab_name: sheet.tabName,
        report_type: reportType,
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

  await syncSheetNow(organizationId);

  return { success: true, sheetUrl: sheet.sheetUrl };
}

export async function syncSheetNow(
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getServiceRoleClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, tab_name, report_type, sheet_url, sync_interval_minutes, created_by"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (syncError || !syncConfig) {
    return { success: false, error: "Sheet sync not configured" };
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

  const { rows, error: rowsError } = await buildOrganizationReportRows(
    organizationId,
    syncConfig.report_type as ReportType
  );

  if (rowsError || !rows) {
    return { success: false, error: rowsError || "Failed to build report" };
  }

  const updated = await updateSpreadsheetValues(
    accessToken,
    syncConfig.sheet_id,
    syncConfig.tab_name || DEFAULT_TAB_NAME,
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
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getServiceRoleClient();
  const { error: updateError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({
      auto_sync: updates.autoSync,
      sync_interval_minutes: updates.syncIntervalMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("Failed to update sheet sync settings:", updateError);
    return { success: false, error: "Failed to update sync settings" };
  }

  return { success: true };
}

export async function updateSheetSyncConfig(
  organizationId: string,
  updates: { reportType?: ReportType; tabName?: string }
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { success: false, error: access.error };
  }

  if (access.role !== "admin") {
    return { success: false, error: "Admin access required" };
  }

  const serviceSupabase = getServiceRoleClient();
  const { error: updateError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .update({
      report_type: updates.reportType,
      tab_name: updates.tabName,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("Failed to update sheet sync config:", updateError);
    return { success: false, error: "Failed to update sheet config" };
  }

  return { success: true };
}