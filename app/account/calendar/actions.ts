"use server";

import { createClient } from "@/utils/supabase/server";
import { getCalendarConnection } from "@/services/calendar";

/**
 * Refreshes the calendar connection by checking if it's still valid
 * and refreshing the access token if needed
 */
export async function refreshCalendarConnection() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    // getCalendarConnection will automatically refresh if token is expired
    const connection = await getCalendarConnection(user.id);

    if (!connection) {
      return { success: false, error: "No calendar connection found" };
    }

    return { success: true, connection };
  } catch (error) {
    console.error("Failed to refresh calendar connection:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to refresh connection",
    };
  }
}

/**
 * Gets the count of synced events for the current user
 */
export async function getSyncedEventsCount() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    // Count creator projects with synced events
    const { count: creatorCount } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .not("creator_calendar_event_id", "is", null);

    // Count volunteer signups with synced events
    const { count: volunteerCount } = await supabase
      .from("project_signups")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("volunteer_calendar_event_id", "is", null);

    return {
      success: true,
      counts: {
        creator: creatorCount || 0,
        volunteer: volunteerCount || 0,
        total: (creatorCount || 0) + (volunteerCount || 0),
      },
    };
  } catch (error) {
    console.error("Failed to get synced events count:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get event count",
    };
  }
}
