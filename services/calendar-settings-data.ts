import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CalendarConnection, EventType, ProjectSchedule } from "@/types";
import {
  getCalendarConnection,
  hasLegacyGoogleOAuthReconnectRequired,
} from "@/services/calendar";
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
    scheduled_start: string | null;
    scheduled_end: string | null;
    project:
      | {
          id: string;
          title: string;
          description: string | null;
          location: string | null;
          event_type: EventType;
        }
      | {
          id: string;
          title: string;
          description: string | null;
          location: string | null;
          event_type: EventType;
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
      scheduled_start,
      scheduled_end,
      project:project_id (
        id,
        title,
        description,
        location,
        event_type
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
          creator_synced_at: project.creator_synced_at ?? dates.start_date,
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
        !signup.scheduled_start ||
        !signup.scheduled_end ||
        !project.event_type
      ) {
        return null;
      }
      return {
        id: signup.id,
        volunteer_calendar_event_id: signup.volunteer_calendar_event_id,
        volunteer_synced_at:
          signup.volunteer_synced_at ?? signup.scheduled_start,
        scheduled_start: signup.scheduled_start,
        scheduled_end: signup.scheduled_end,
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

  return {
    connection,
    legacyReconnectRequired,
    creatorProjects: normalizedCreatorProjects,
    volunteerSignups: normalizedVolunteerSignups,
  };
}
