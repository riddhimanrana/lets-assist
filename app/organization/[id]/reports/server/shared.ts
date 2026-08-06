import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getSheetsConnection,
  getGoogleAccessTokenForSheets,
  getGoogleAccessTokenForSheetsForUser,
  organizationSheetsGoogleBinding,
} from "@/services/calendar";
import type { ReportType } from "../actions";
import type { ReportLayoutConfig } from "../report-layouts";

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

export const DEFAULT_TAB_NAME = "Member Hours";
export const DEFAULT_SYNC_INTERVAL_MINUTES = 1440;
export const DEFAULT_RANGE_A1 = "A1";
export const MIN_SYNC_INTERVAL_MINUTES = 60;

export function getOrganizationSheetsConnection(
  userId: string,
  organizationId: string,
  useServiceRole = false,
) {
  return getSheetsConnection(
    userId,
    organizationSheetsGoogleBinding(organizationId),
    useServiceRole,
  );
}

export function getOrganizationSheetsAccessToken(
  userId: string,
  organizationId: string,
  useServiceRole = false,
) {
  if (useServiceRole) {
    return getGoogleAccessTokenForSheetsForUser(
      userId,
      true,
      organizationSheetsGoogleBinding(organizationId),
    );
  }
  return getGoogleAccessTokenForSheets(
    userId,
    organizationSheetsGoogleBinding(organizationId),
  );
}

export function hasConfiguredSheetDestination(
  syncConfig:
    | {
        sheet_id?: string | null;
        sheet_url?: string | null;
        tab_name?: string | null;
        report_type?: string | null;
      }
    | null
    | undefined,
) {
  return Boolean(
    syncConfig?.sheet_id?.trim() &&
    syncConfig?.sheet_url?.trim() &&
    syncConfig?.tab_name?.trim() &&
    syncConfig?.report_type?.trim(),
  );
}

export async function assertOrgAccess(organizationId: string) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) {
    return { error: "Authentication required", userId: null };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .single();

  const canView = membership?.role === "admin" || membership?.role === "staff";
  if (!canView) {
    return { error: "Permission denied", userId: null };
  }

  return { error: undefined, userId: authData.user.id, role: membership?.role };
}
