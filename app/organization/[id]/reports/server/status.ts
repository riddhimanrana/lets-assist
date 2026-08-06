"use server";

import { getAdminClient } from "@/lib/supabase/admin";
import { hasGoogleSheetsScopes } from "@/services/calendar";
import type { ReportType } from "../actions";
import {
  assertOrgAccess,
  getOrganizationSheetsConnection,
  hasConfiguredSheetDestination,
  type SheetSyncStatus,
} from "./shared";

export async function getSheetSyncStatus(
  organizationId: string,
): Promise<SheetSyncStatus> {
  const access = await assertOrgAccess(organizationId);
  if (access.error || !access.userId) {
    return { connected: false, error: access.error ?? undefined };
  }

  const connection = await getOrganizationSheetsConnection(
    access.userId,
    organizationId,
  );

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_sheet_syncs")
    .select(
      "sheet_id, sheet_url, sheet_title, tab_name, range_a1, report_type, layout_config, auto_sync, sync_interval_minutes, last_synced_at, created_by",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  const viewerConnected = !!connection;
  const viewerScopesOk = connection
    ? hasGoogleSheetsScopes(connection.granted_scopes)
    : false;

  let connectedBy: SheetSyncStatus["connectedBy"] = null;
  let connected = !!connection;
  let connectedEmail = connection?.calendar_email || null;
  let scopesOk = connection
    ? hasGoogleSheetsScopes(connection.granted_scopes)
    : false;
  const viewerIsOwner = syncConfig?.created_by
    ? syncConfig.created_by === access.userId
    : false;
  const destinationConfigured = hasConfiguredSheetDestination(syncConfig);

  if (syncConfig?.created_by) {
    const ownerConnection = await getOrganizationSheetsConnection(
      syncConfig.created_by,
      organizationId,
      true,
    );

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
