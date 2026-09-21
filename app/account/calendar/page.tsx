import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarClient from "./CalendarClient";
import { getCalendarData } from "@/services/calendar-settings-data";

export const metadata = {
  title: "Calendar Settings - Let's Assist",
  description: "Manage your calendar integrations and synced events",
};

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
