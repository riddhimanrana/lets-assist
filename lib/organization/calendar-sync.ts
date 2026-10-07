import { safeConsole } from "@/lib/safe-console";
import "server-only";

import { revalidatePath } from "next/cache";

import {
  ensureOrganizationCalendar,
  formatProjectToCalendarEvent,
  getGoogleAccessTokenForUser,
  organizationCalendarGoogleBinding,
} from "@/services/calendar";
import { getAdminClient } from "@/lib/supabase/admin";
import { reconcileOrganizationCalendar } from "@/services/organization-calendar/reconcile";
import { loadCalendarSourcePages } from "./calendar-source-pages";
import { syncCsfCalendarProjections } from "@/lib/organization/csf-calendar-sync";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import type { Project } from "@/types";

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

  const accessToken = await getGoogleAccessTokenForUser(
    syncConfig.created_by,
    true,
    {
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
    ? `Let's Assist: ${org.name} Volunteering`
    : "Let's Assist Organization Volunteering";

  const ensured = await ensureOrganizationCalendar(
    accessToken,
    syncConfig.calendar_id,
    calendarName,
    { organizationId, userId: syncConfig.created_by },
  );

  if (!ensured) {
    return { success: false, error: "Failed to access organization calendar" };
  }

  const eventSyncResult = await reconcileOrganizationCalendar({
    userId: syncConfig.created_by,
    organizationId,
    accessToken,
    calendarId: ensured.calendarId,
    sourceKinds: [PROJECT_SCHEDULE_SOURCE_KIND],
    load: async () => {
      const projects = await loadCalendarSourcePages<Project>((after, size) => {
        let query = serviceSupabase
          .from("projects")
          .select("*")
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .or("workflow_status.is.null,workflow_status.eq.published")
          .order("id")
          .limit(size);
        if (after) query = query.gt("id", after);
        return query;
      });
      return projects.flatMap((project) =>
        getProjectScheduleIds(project).map((scheduleId) => {
          const event = formatProjectToCalendarEvent(project, scheduleId);
          if (!event || Array.isArray(event))
            throw new Error("Project calendar schedule is invalid.");
          return {
            source_kind: PROJECT_SCHEDULE_SOURCE_KIND,
            source_id: project.id,
            occurrence_key: scheduleId,
            event,
          };
        }),
      );
    },
  });

  if (!eventSyncResult.success) {
    return eventSyncResult;
  }

  const csfSyncResult = await syncCsfCalendarProjections({
    userId: syncConfig.created_by,
    organizationId,
    accessToken,
    calendarId: ensured.calendarId,
  });
  if (!csfSyncResult.success) {
    return csfSyncResult;
  }

  const { data: completedSync, error: completionError } = await serviceSupabase
    .from("organization_calendar_syncs")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .select("organization_id")
    .maybeSingle();
  if (completionError || !completedSync) {
    safeConsole.error(
      "Failed to record organization calendar sync completion",
      completionError,
    );
    return {
      success: false,
      error: "Calendar events synced, but completion could not be recorded",
    };
  }

  revalidatePath(`/organization/${organizationId}`);
  revalidatePath(`/organization/${organizationId}/settings`);

  return {
    success: true,
    createdCount: eventSyncResult.createdCount + csfSyncResult.createdCount,
    updatedCount: eventSyncResult.updatedCount + csfSyncResult.updatedCount,
    removedCount: eventSyncResult.removedCount + csfSyncResult.removedCount,
  };
}
