import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import CalendarClient from "./CalendarClient";

export const metadata = {
  title: "Calendar Settings - Let's Assist",
  description: "Manage your calendar integrations and synced events",
};

async function getCalendarData(userId: string) {
  const supabase = await createClient();

  // Get calendar connection status
  const { data: connection } = await supabase
    .from("user_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  // Get synced events (projects created by user)
  const { data: creatorProjects } = await supabase
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
    .not("creator_calendar_event_id", "is", null);

  // Get synced events (signups by user)
  const { data: volunteerSignups } = await supabase
    .from("project_signups")
    .select(
      `
      id,
      volunteer_calendar_event_id,
      volunteer_synced_at,
      scheduled_start,
      scheduled_end,
      projects:project_id (
        id,
        title,
        description,
        location,
        schedule_type
      )
    `
    )
    .eq("user_id", userId)
    .not("volunteer_calendar_event_id", "is", null);

  return {
    connection: connection || null,
    creatorProjects: creatorProjects || [],
    volunteerSignups: volunteerSignups || [],
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
