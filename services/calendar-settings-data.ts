import "server-only";
import { getPersonalCalendarCleanup } from "./personal-calendar/cleanup";
import { createClient } from "@/lib/supabase/server";
import type { CalendarConnection, EventType, ProjectSchedule } from "@/types";
import {
  getCalendarConnection,
  hasLegacyGoogleOAuthReconnectRequired,
} from "@/services/calendar";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getCalendarProjectDates } from "@/lib/calendar-project-dates";

export async function getCalendarData(userId: string) {
  const supabase = await createClient();

  type CreatorProjectRow = {
    id: string;
    title: string;
    description: string | null;
    event_type: EventType;
    schedule: ProjectSchedule;
    location: string | null;
    creator_calendar_event_id: string | null;
    creator_synced_at: string | null;
  };

  type VolunteerSignupRow = {
    id: string;
    volunteer_calendar_event_id: string | null;
    volunteer_synced_at: string | null;
    schedule_id: string;
    project:
      | {
          id: string;
          title: string;
          description: string | null;
          location: string | null;
          event_type: EventType;
          schedule: ProjectSchedule | null;
          project_timezone: string | null;
        }
      | {
          id: string;
          title: string;
          description: string | null;
          location: string | null;
          event_type: EventType;
          schedule: ProjectSchedule | null;
          project_timezone: string | null;
        }[]
      | null;
  };

  // Get calendar connection status
  const connection: CalendarConnection | null =
    await getCalendarConnection(userId);
  const legacyReconnectRequired = connection
    ? false
    : await hasLegacyGoogleOAuthReconnectRequired(userId);

  // Get synced events (projects created by user)
  const { data: creatorProjects, error: creatorError } = (await supabase
    .from("projects")
    .select(
      `
      id,
      title,
      description,
      event_type,
      schedule,
      location,
      creator_calendar_event_id,
      creator_synced_at
    `,
    )
    .eq("creator_id", userId)
    .not("creator_calendar_event_id", "is", null)) as {
    data: CreatorProjectRow[] | null;
    error: unknown;
  };

  // Get synced events (signups by user)
  const { data: volunteerSignups, error: signupError } = (await supabase
    .from("project_signups")
    .select(
      `
      id,
      volunteer_calendar_event_id,
      volunteer_synced_at,
      schedule_id,
      project:project_id (
        id,
        title,
        description,
        location,
        event_type,
        schedule,
        project_timezone
      )
    `,
    )
    .eq("user_id", userId)
    .not("volunteer_calendar_event_id", "is", null)) as {
    data: VolunteerSignupRow[] | null;
    error: unknown;
  };

  if (creatorError || signupError) {
    throw new Error("Synced calendar events could not be loaded.");
  }
  const normalizedCreatorProjects = (creatorProjects ?? []).flatMap(
    (project) => {
      const dates = getCalendarProjectDates(
        project.event_type,
        project.schedule,
      );
      if (!project.creator_calendar_event_id || !dates) return [];
      return [
        {
          id: project.id,
          title: project.title,
          description: project.description ?? null,
          ...dates,
          location: project.location ?? null,
          creator_calendar_event_id: project.creator_calendar_event_id,
          creator_synced_at: project.creator_synced_at,
          schedule_type: project.event_type,
        },
      ];
    },
  );

  const normalizedVolunteerSignups = (volunteerSignups || [])
    .map((signup) => {
      const project = Array.isArray(signup.project)
        ? signup.project[0]
        : signup.project;
      if (
        !project ||
        !signup.volunteer_calendar_event_id ||
        !project.schedule ||
        !project.event_type
      ) {
        return null;
      }
      const window = getAttendanceScheduleWindow(
        {
          ...project,
          schedule: project.schedule,
          project_timezone: project.project_timezone ?? undefined,
        },
        signup.schedule_id,
      );
      if (!window) return null;
      return {
        id: signup.id,
        volunteer_calendar_event_id: signup.volunteer_calendar_event_id,
        volunteer_synced_at: signup.volunteer_synced_at,
        scheduled_start: new Date(window.startsAt).toISOString(),
        scheduled_end: new Date(window.endsAt).toISOString(),
        projects: {
          id: project.id,
          title: project.title,
          description: project.description ?? null,
          location: project.location ?? null,
          schedule_type: project.event_type,
        },
      };
    })
    .filter((signup): signup is NonNullable<typeof signup> => signup !== null);

  const cleanupEvents = await getPersonalCalendarCleanup(userId);
  return {
    cleanupEvents,
    connection,
    legacyReconnectRequired,
    creatorProjects: normalizedCreatorProjects,
    volunteerSignups: normalizedVolunteerSignups,
  };
}
