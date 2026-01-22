import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import CalendarClient from "./CalendarClient";
import type { CalendarConnection } from "@/types/calendar";

export const metadata = {
  title: "Calendar Settings - Let's Assist",
  description: "Manage your calendar integrations and synced events",
};

async function getCalendarData(userId: string) {
  const supabase = await createClient();

  type CreatorProjectRow = {
    id: string;
    title: string;
    description: string | null;
    start_date: string | null;
    end_date: string | null;
    location: string | null;
    creator_calendar_event_id: string | null;
    creator_synced_at: string | null;
    schedule_type: string | null;
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
          schedule_type: string | null;
        }
      | {
          id: string;
          title: string;
          description: string | null;
          location: string | null;
          schedule_type: string | null;
        }[]
      | null;
  };

  // Get calendar connection status
  const { data: connection } = (await supabase
    .from("user_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single()) as { data: CalendarConnection | null };

  // Get synced events (projects created by user)
  const { data: creatorProjects } = (await supabase
    .from("projects")
    .select(
      `
      id,
      title,
      description,
      start_date,
      end_date,
      location,
      creator_calendar_event_id,
      creator_synced_at,
      schedule_type
    `
    )
    .eq("creator_id", userId)
    .not("creator_calendar_event_id", "is", null)) as { data: CreatorProjectRow[] | null };

  // Get synced events (signups by user)
  const { data: volunteerSignups } = (await supabase
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
        schedule_type
      )
    `
    )
    .eq("user_id", userId)
    .not("volunteer_calendar_event_id", "is", null)) as { data: VolunteerSignupRow[] | null };

    const normalizedCreatorProjects = (creatorProjects || [])
      .filter(
        (project) =>
          project.creator_calendar_event_id &&
          project.start_date &&
          project.schedule_type,
      )
      .map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description ?? null,
        start_date: project.start_date as string,
        end_date: project.end_date ?? null,
        location: project.location ?? null,
        creator_calendar_event_id: project.creator_calendar_event_id as string,
        creator_synced_at: project.creator_synced_at ?? project.start_date ?? "",
        schedule_type: project.schedule_type as string,
      }));

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
          !project.schedule_type
        ) {
          return null;
        }
        return {
          id: signup.id,
          volunteer_calendar_event_id: signup.volunteer_calendar_event_id,
          volunteer_synced_at: signup.volunteer_synced_at ?? signup.scheduled_start,
          scheduled_start: signup.scheduled_start,
          scheduled_end: signup.scheduled_end,
          projects: {
            id: project.id,
            title: project.title,
            description: project.description ?? null,
            location: project.location ?? null,
            schedule_type: project.schedule_type,
          },
        };
      })
      .filter((signup): signup is NonNullable<typeof signup> => signup !== null);

    return {
      connection,
      creatorProjects: normalizedCreatorProjects,
      volunteerSignups: normalizedVolunteerSignups,
    };
}

export default async function CalendarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const calendarData = await getCalendarData(user.id);

  return <CalendarClient {...calendarData} />;
}
