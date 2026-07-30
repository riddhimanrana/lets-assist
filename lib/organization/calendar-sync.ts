import "server-only";

import { revalidatePath } from "next/cache";

import {
  createGoogleCalendarEventForCalendar,
  deleteGoogleCalendarEventForCalendar,
  ensureOrganizationCalendar,
  getGoogleAccessTokenForUser,
  organizationCalendarGoogleBinding,
  updateGoogleCalendarEventForCalendar,
} from "@/services/calendar";
import { getAdminClient } from "@/lib/supabase/admin";
import { synchronizeCalendarEvents } from "@/lib/organization/calendar-event-sync-core";
import { resolveCalendarSyncSources } from "@/lib/organization/calendar-sync-safety";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import type { Project } from "@/types";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// organization_calendar_events is a generalized binding table: one row per
// projected occurrence of some published record, tagged by source_kind. This
// sync owns exactly one of those kinds. CSF projections live in the same table
// and are written by a separate server-only path, so every read and every
// tracking-row mutation here is scoped to project bindings — an unscoped
// select would report CSF rows as stale project bindings and delete them.
const PROJECT_SCHEDULE_SOURCE_KIND = "project_schedule";

export type OrganizationCalendarSyncResult = {
  success: boolean;
  createdCount?: number;
  updatedCount?: number;
  removedCount?: number;
  error?: string;
};

function getProjectScheduleIds(project: Project): string[] {
  if (project.event_type === "oneTime") {
    return ["oneTime"];
  }

  if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const scheduleIds: string[] = [];
    project.schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((_, slotIndex) => {
        scheduleIds.push(`${day.date}-${dayIndex}-${slotIndex}`);
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

export async function syncOrganizationCalendarInternal(
  organizationId: string,
): Promise<OrganizationCalendarSyncResult> {
  const serviceSupabase = getAdminClient();
  const { data: org, error: orgError } = await serviceSupabase
    .from("organizations")
    .select("name, username")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const { data: syncConfig, error: syncConfigError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .select("calendar_id, created_by, calendar_email, auto_sync")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (syncConfigError) {
    return {
      success: false,
      error: "Failed to load organization calendar configuration",
    };
  }

  if (!syncConfig?.created_by) {
    return { success: false, error: "Organization calendar not connected" };
  }

  const ownerAuthorization = await authorizeGoogleOAuthOrganizationRequest({
    userId: syncConfig.created_by,
    organizationId,
    pluginKey: null,
    purpose: "organization_calendar",
    requestedCapability: null,
  });
  if (!ownerAuthorization.allowed) {
    await serviceSupabase
      .from("organization_calendar_syncs")
      .update({ auto_sync: false, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);
    return {
      success: false,
      error: "Calendar owner no longer has active organization admin access",
    };
  }

  // Load every source of truth before touching Google. Treating a failed query
  // as an empty result would otherwise delete valid remote events.
  const projectsResult = await serviceSupabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .neq("status", "cancelled");

  // source_kind is both the filter and the returned evidence: the reconciler
  // may only ever see rows this sync is authoritative for.
  const existingEventsResult = await serviceSupabase
    .from("organization_calendar_events")
    .select("id, project_id, schedule_id, event_id, source_kind")
    .eq("organization_id", organizationId)
    .eq("source_kind", PROJECT_SCHEDULE_SOURCE_KIND);

  const sources = resolveCalendarSyncSources(
    projectsResult,
    existingEventsResult,
  );
  if (!sources.ok) {
    return { success: false, error: sources.error };
  }

  const { projects, existingEvents } = sources;

  const accessToken = await getGoogleAccessTokenForUser(
    syncConfig.created_by,
    true,
    {
      requiredScopes: [CALENDAR_SCOPE],
      connectionType: "calendar",
      expectedBinding: organizationCalendarGoogleBinding(organizationId),
    },
  );

  if (!accessToken) {
    return {
      success: false,
      error: "Google connection missing. Ask the calendar owner to reconnect.",
    };
  }

  const calendarName = org.name
    ? `Let's Assist — ${org.name} Volunteering`
    : "Let's Assist Organization Volunteering";

  const ensured = await ensureOrganizationCalendar(
    accessToken,
    syncConfig.calendar_id,
    calendarName,
  );

  if (!ensured) {
    return { success: false, error: "Failed to access organization calendar" };
  }

  if (ensured.calendarId !== syncConfig.calendar_id) {
    const { error: calendarIdError } = await serviceSupabase
      .from("organization_calendar_syncs")
      .update({
        calendar_id: ensured.calendarId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);

    if (calendarIdError) {
      return {
        success: false,
        error: "Failed to save organization calendar configuration",
      };
    }
  }

  const desiredEvents = projects.flatMap((project) => {
    const typedProject = project as Project;
    return getProjectScheduleIds(typedProject).map((scheduleId) => ({
      key: `${project.id}:${scheduleId}`,
      projectId: project.id,
      project: typedProject,
      scheduleId,
    }));
  });
  // Re-checking source_kind in memory keeps the deletion pass safe even if the
  // query filter above is ever weakened; a non-project row is dropped rather
  // than handed to the reconciler as a stale project binding.
  const trackedEvents = existingEvents
    .filter((event) => event.source_kind === PROJECT_SCHEDULE_SOURCE_KIND)
    .map((event) => ({
      id: event.id,
      key: `${event.project_id}:${event.schedule_id}`,
      eventId: event.event_id,
    }));

  const eventSyncResult = await synchronizeCalendarEvents(
    desiredEvents,
    trackedEvents,
    {
      createRemoteEvent: (desired) =>
        createGoogleCalendarEventForCalendar(
          accessToken,
          ensured.calendarId,
          desired.project,
          desired.scheduleId,
        ),
      updateRemoteEvent: (tracked, desired) =>
        updateGoogleCalendarEventForCalendar(
          accessToken,
          ensured.calendarId,
          tracked.eventId,
          desired.project,
          desired.scheduleId,
        ),
      deleteRemoteEvent: (eventId) =>
        deleteGoogleCalendarEventForCalendar(
          accessToken,
          ensured.calendarId,
          eventId,
        ),
      insertTrackingEvent: async (desired, eventId) => {
        const { data, error } = await serviceSupabase
          .from("organization_calendar_events")
          .insert({
            organization_id: organizationId,
            // Legacy project coordinates stay written so existing readers,
            // constraints, and client RLS predicates keep working.
            project_id: desired.projectId,
            schedule_id: desired.scheduleId,
            // Generalized binding coordinates are declared here rather than
            // left to the database trigger to derive.
            source_kind: PROJECT_SCHEDULE_SOURCE_KIND,
            source_id: desired.projectId,
            occurrence_key: desired.scheduleId,
            event_id: eventId,
          })
          .select("id")
          .single();
        if (error || !data) {
          console.error("Failed to insert organization calendar tracking row", error);
          return false;
        }
        return true;
      },
      updateTrackingEvent: async (tracked) => {
        const { data, error } = await serviceSupabase
          .from("organization_calendar_events")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", tracked.id)
          .eq("source_kind", PROJECT_SCHEDULE_SOURCE_KIND)
          .select("id")
          .maybeSingle();
        if (error || !data) {
          console.error("Failed to update organization calendar tracking row", error);
          return false;
        }
        return true;
      },
      deleteTrackingEvent: async (tracked) => {
        const { data, error } = await serviceSupabase
          .from("organization_calendar_events")
          .delete()
          .eq("id", tracked.id)
          .eq("source_kind", PROJECT_SCHEDULE_SOURCE_KIND)
          .select("id")
          .maybeSingle();
        if (error || !data) {
          console.error("Failed to delete organization calendar tracking row", error);
          return false;
        }
        return true;
      },
      markSyncComplete: async () => {
        const { data, error } = await serviceSupabase
          .from("organization_calendar_syncs")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("organization_id", organizationId)
          .select("organization_id")
          .maybeSingle();
        if (error || !data) {
          console.error("Failed to record organization calendar sync completion", error);
          return false;
        }
        return true;
      },
    },
  );

  if (!eventSyncResult.success) {
    return eventSyncResult;
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return eventSyncResult;
}
