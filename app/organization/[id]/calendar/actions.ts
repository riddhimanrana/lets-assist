"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { deactivateGoogleConnection } from "@/services/calendar";
import { organizationCalendarGoogleBinding } from "@/services/calendar";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import {
  syncOrganizationCalendarInternal,
  type OrganizationCalendarSyncResult,
} from "@/lib/organization/calendar-sync";

type OrgCalendarStatus = {
  connected: boolean;
  connectedEmail?: string | null;
  connectedBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  calendarId?: string | null;
  autoSync?: boolean;
  lastSyncedAt?: string | null;
  canManage: boolean;
  viewerIsOwner?: boolean;
  needsReconnect?: boolean;
  error?: string;
};

type OrgAccess = {
  userId: string;
  role: string | null;
  error?: string;
};

async function assertOrgAccess(
  organizationId: string,
  requireAdmin = false,
): Promise<OrgAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: "", role: null, error: "Authentication required" };
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!membership?.role) {
    return { userId: user.id, role: null, error: "Permission denied" };
  }

  if (requireAdmin && membership.role !== "admin") {
    return { userId: user.id, role: membership.role, error: "Admin access required" };
  }

  return { userId: user.id, role: membership.role };
}

export async function getOrganizationCalendarStatus(
  organizationId: string
): Promise<OrgCalendarStatus> {
  const access = await assertOrgAccess(organizationId);
  if (access.error) {
    return {
      connected: false,
      canManage: false,
      error: access.error,
    };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .select(
      "calendar_id, created_by, auto_sync, last_synced_at"
    )
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (syncError) {
    console.error("Failed to load org calendar config:", syncError);
    return {
      connected: false,
      canManage: access.role === "admin",
      error: "Calendar configuration not available",
    };
  }

  if (!syncConfig) {
    return {
      connected: false,
      canManage: access.role === "admin",
      viewerIsOwner: false,
    };
  }

  const { data: ownerProfile } = await serviceSupabase
    .from("profiles")
    .select("id, full_name, username, email")
    .eq("id", syncConfig.created_by)
    .maybeSingle();

  const ownerConnection = syncConfig.created_by
    ? await getGoogleOAuthConnectionForBinding(
        syncConfig.created_by,
        organizationCalendarGoogleBinding(organizationId),
        { useServiceRole: true },
      )
    : null;

  const connected = !!ownerConnection;
  const connectedEmail = ownerConnection?.calendar_email ?? null;

  return {
    connected,
    connectedEmail,
    connectedBy: syncConfig.created_by
      ? {
          id: syncConfig.created_by,
          name: ownerProfile?.full_name || ownerProfile?.username || null,
          email: ownerProfile?.email || connectedEmail || null,
        }
      : null,
    calendarId: syncConfig.calendar_id,
    autoSync: syncConfig.auto_sync,
    lastSyncedAt: syncConfig.last_synced_at,
    canManage: access.role === "admin",
    viewerIsOwner: syncConfig.created_by === access.userId,
    needsReconnect: !ownerConnection,
  };
}

export async function disconnectOrganizationCalendarConnection(
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getAdminClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .select("created_by")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (syncError) {
    console.error("Failed to load org calendar sync before disconnect:", syncError);
    return { success: false, error: "Failed to verify calendar owner" };
  }

  if (!syncConfig?.created_by) {
    return { success: false, error: "Calendar sync not configured" };
  }

  if (syncConfig.created_by !== access.userId) {
    return {
      success: false,
      error: "Only the connected Google account owner can remove this connection.",
    };
  }

  const deactivateResult = await deactivateGoogleConnection(access.userId, {
    expectedBinding: organizationCalendarGoogleBinding(organizationId),
    useServiceRole: true,
    revokeAccess: false,
  });
  if (!deactivateResult.success) {
    return { success: false, error: deactivateResult.error || "Failed to disconnect Google account" };
  }

  const { error: eventsError } = await serviceSupabase
    .from("organization_calendar_events")
    .delete()
    .eq("organization_id", organizationId);

  if (eventsError) {
    console.error("Failed to delete org calendar events during account disconnect:", eventsError);
    return { success: false, error: "Failed to remove calendar events" };
  }

  const { error: syncErrorDelete } = await serviceSupabase
    .from("organization_calendar_syncs")
    .delete()
    .eq("organization_id", organizationId);

  if (syncErrorDelete) {
    console.error("Failed to delete org calendar sync during account disconnect:", syncErrorDelete);
    return { success: false, error: "Failed to disconnect calendar" };
  }

  revalidatePath(`/organization/${organizationId}/settings`);
  return { success: true };
}

export async function updateOrganizationCalendarSettings(
  organizationId: string,
  updates: { autoSync?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getAdminClient();
  const { error } = await serviceSupabase
    .from("organization_calendar_syncs")
    .update({
      auto_sync: updates.autoSync,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);

  if (error) {
    console.error("Failed to update org calendar settings:", error);
    return { success: false, error: "Failed to update calendar settings" };
  }

  revalidatePath(`/organization/${organizationId}/settings`);
  return { success: true };
}

export async function disconnectOrganizationCalendar(
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getAdminClient();
  const { error: eventsError } = await serviceSupabase
    .from("organization_calendar_events")
    .delete()
    .eq("organization_id", organizationId);

  if (eventsError) {
    console.error("Failed to delete org calendar events:", eventsError);
    return { success: false, error: "Failed to remove calendar events" };
  }

  const { error: syncError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .delete()
    .eq("organization_id", organizationId);

  if (syncError) {
    console.error("Failed to delete org calendar sync:", syncError);
    return { success: false, error: "Failed to disconnect calendar" };
  }

  revalidatePath(`/organization/${organizationId}/settings`);
  return { success: true };
}

export async function syncOrganizationCalendarNow(
  organizationId: string,
): Promise<OrganizationCalendarSyncResult> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  return syncOrganizationCalendarInternal(organizationId);
}
