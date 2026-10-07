"use server";
import { safeConsole } from "@/lib/safe-console";

import { createClient } from "@/lib/supabase/server";
import { getCalendarConnection } from "@/services/calendar";

/** Reads the current calendar connection for the signed-in account. */
export async function refreshCalendarConnection() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  try {
    const connection = await getCalendarConnection(user.id);

    if (!connection) {
      return { success: false, error: "No calendar connection found" };
    }

    return {
      success: true,
      connection: {
        calendar_email: connection.calendar_email,
        created_at: connection.created_at,
      },
    };
  } catch (error) {
    safeConsole.error("Failed to refresh calendar connection:", error);
    return {
      success: false,
      error: "Failed to refresh connection",
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
    const { count: creatorCount } = (await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", user.id)
      .not("creator_calendar_event_id", "is", null)) as {
      count: number | null;
    };

    // Count volunteer signups with synced events
    const { count: volunteerCount } = (await supabase
      .from("project_signups")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("volunteer_calendar_event_id", "is", null)) as {
      count: number | null;
    };

    return {
      success: true,
      counts: {
        creator: creatorCount || 0,
        volunteer: volunteerCount || 0,
        total: (creatorCount || 0) + (volunteerCount || 0),
      },
    };
  } catch (error) {
    safeConsole.error("Failed to get synced events count:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get event count",
    };
  }
}
