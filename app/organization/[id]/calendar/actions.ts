"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import {
  createGoogleCalendarEventForCalendar,
  deleteGoogleCalendarEventForCalendar,
  ensureOrganizationCalendar,
  getGoogleAccessTokenForUser,
  updateGoogleCalendarEventForCalendar,
} from "@/services/calendar";
import type { Project } from "@/types";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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
  requireAdmin = false
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
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (!membership?.role) {
    return { userId: user.id, role: null, error: "Permission denied" };
  }

  if (requireAdmin && membership.role !== "admin") {
    return { userId: user.id, role: membership.role, error: "Admin access required" };
  }

  return { userId: user.id, role: membership.role };
}

function getProjectScheduleIds(project: Project): string[] {
  if (project.event_type === "oneTime") {
    return ["oneTime"];
  }

  if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const scheduleIds: string[] = [];
    project.schedule.multiDay.forEach((day) => {
      day.slots.forEach((slot, slotIndex) => {
        scheduleIds.push(`${day.date}-${slotIndex}`);
      });
    });
    return scheduleIds;
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    return project.schedule.sameDayMultiArea.roles.map((role) => role.name);
  }

  return [];
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

  const serviceSupabase = getServiceRoleClient();
  const { data: syncConfig, error: syncError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .select(
      "calendar_id, calendar_email, created_by, auto_sync, last_synced_at"
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
    };
  }

  const { data: ownerProfile } = await serviceSupabase
    .from("profiles")
    .select("id, full_name, username, email")
    .eq("id", syncConfig.created_by)
    .maybeSingle();

  const { data: ownerConnection } = await serviceSupabase
    .from("user_calendar_connections")
    .select("calendar_email")
    .eq("user_id", syncConfig.created_by)
    .eq("provider", "google")
    .eq("is_active", true)
    .maybeSingle();

  const connected = !!ownerConnection;
  const connectedEmail = ownerConnection?.calendar_email ?? syncConfig.calendar_email;

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
    needsReconnect: !ownerConnection,
  };
}

export async function updateOrganizationCalendarSettings(
  organizationId: string,
  updates: { autoSync?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getServiceRoleClient();
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

  const serviceSupabase = getServiceRoleClient();
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
  organizationId: string
): Promise<{
  success: boolean;
  createdCount?: number;
  updatedCount?: number;
  removedCount?: number;
  error?: string;
}> {
  const access = await assertOrgAccess(organizationId, true);
  if (access.error) {
    return { success: false, error: access.error };
  }

  const serviceSupabase = getServiceRoleClient();
  const { data: org } = await serviceSupabase
    .from("organizations")
    .select("name, username")
    .eq("id", organizationId)
    .single();

  const { data: syncConfig } = await serviceSupabase
    .from("organization_calendar_syncs")
    .select("calendar_id, created_by, calendar_email, auto_sync")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!syncConfig?.created_by) {
    return { success: false, error: "Organization calendar not connected" };
  }

  const accessToken = await getGoogleAccessTokenForUser(
    syncConfig.created_by,
    true,
    { requiredScopes: [CALENDAR_SCOPE], connectionType: "calendar" }
  );

  if (!accessToken) {
    return {
      success: false,
      error: "Google connection missing. Ask the calendar owner to reconnect.",
    };
  }

  const calendarName = org?.name
    ? `Let's Assist — ${org.name} Volunteering`
    : "Let's Assist Organization Volunteering";

  const ensured = await ensureOrganizationCalendar(
    accessToken,
    syncConfig.calendar_id,
    calendarName
  );

  if (!ensured) {
    return { success: false, error: "Failed to access organization calendar" };
  }

  if (ensured.calendarId !== syncConfig.calendar_id) {
    await serviceSupabase
      .from("organization_calendar_syncs")
      .update({
        calendar_id: ensured.calendarId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);
  }

  const { data: projects } = await serviceSupabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .neq("status", "cancelled");

  const { data: existingEvents } = await serviceSupabase
    .from("organization_calendar_events")
    .select("id, project_id, schedule_id, event_id")
    .eq("organization_id", organizationId);

  const existingMap = new Map<string, {
    id: string;
    eventId: string;
  }>();
  (existingEvents || []).forEach((event) => {
    existingMap.set(`${event.project_id}:${event.schedule_id}`, {
      id: event.id,
      eventId: event.event_id,
    });
  });

  const desiredKeys = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;
  let removedCount = 0;

  for (const project of projects || []) {
    const scheduleIds = getProjectScheduleIds(project as Project);
    for (const scheduleId of scheduleIds) {
      const key = `${project.id}:${scheduleId}`;
      desiredKeys.add(key);
      const existing = existingMap.get(key);

      if (existing) {
        try {
          const updated = await updateGoogleCalendarEventForCalendar(
            accessToken,
            ensured.calendarId,
            existing.eventId,
            project as Project,
            scheduleId
          );
          if (updated) {
            updatedCount += 1;
            await serviceSupabase
              .from("organization_calendar_events")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", existing.id);
          }
        } catch (error) {
          console.warn("Failed to update org calendar event:", error);
        }
        continue;
      }

      try {
        const eventId = await createGoogleCalendarEventForCalendar(
          accessToken,
          ensured.calendarId,
          project as Project,
          scheduleId
        );

        if (eventId) {
          createdCount += 1;
          await serviceSupabase
            .from("organization_calendar_events")
            .insert({
              organization_id: organizationId,
              project_id: project.id,
              schedule_id: scheduleId,
              event_id: eventId,
            });
        }
      } catch (error) {
        console.warn("Failed to create org calendar event:", error);
      }
    }
  }

  for (const event of existingEvents || []) {
    const key = `${event.project_id}:${event.schedule_id}`;
    if (desiredKeys.has(key)) continue;

    try {
      const removed = await deleteGoogleCalendarEventForCalendar(
        accessToken,
        ensured.calendarId,
        event.event_id
      );

      if (removed) {
        removedCount += 1;
        await serviceSupabase
          .from("organization_calendar_events")
          .delete()
          .eq("id", event.id);
      }
    } catch (error) {
      console.warn("Failed to remove org calendar event:", error);
    }
  }

  await serviceSupabase
    .from("organization_calendar_syncs")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return { success: true, createdCount, updatedCount, removedCount };
}