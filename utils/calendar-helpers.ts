"use server";

import { createClient } from "@/utils/supabase/server";
import { deleteGoogleCalendarEvent } from "@/services/calendar";

/**
 * Updates a calendar event when a project is edited.
 * Call this after successfully updating a project in the database.
 * 
 * @param projectId - The ID of the project that was updated
 * @returns Success or error message
 * 
 * @example
 * // After updating a project:
 * const updateResult = await updateProject(projectId, updatedData);
 * if (updateResult.success) {
 *   await updateCalendarEventForProject(projectId);
 * }
 */
export async function updateCalendarEventForProject(projectId: string) {
  try {
    const supabase = await createClient();

    // Check if project has a calendar event
    const { data: project } = await supabase
      .from("projects")
      .select("creator_calendar_event_id")
      .eq("id", projectId)
      .single();

    if (!project?.creator_calendar_event_id) {
      // No calendar event to update
      return { success: true, message: "No calendar event to update" };
    }

    // Call the sync API to update the event
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/calendar/sync-project`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId }),
      }
    );

    if (!response.ok) {
      const data = await response.json();
      console.error("Failed to update calendar event:", data.error);
      return {
        success: false,
        error: "Failed to update calendar event",
      };
    }

    return {
      success: true,
      message: "Calendar event updated successfully",
    };
  } catch (error) {
    console.error("Error updating calendar event:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update calendar event",
    };
  }
}

/**
 * Removes calendar event when a project is cancelled.
 * Call this after successfully cancelling a project.
 * 
 * @param projectId - The ID of the project that was cancelled
 * @returns Success or error message
 * 
 * @example
 * // After cancelling a project:
 * const cancelResult = await updateProjectStatus(projectId, "cancelled", reason);
 * if (cancelResult.success) {
 *   await removeCalendarEventForProject(projectId);
 * }
 */
export async function removeCalendarEventForProject(projectId: string) {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Error getting user:", userError);
      return { success: false, error: "User not authenticated" };
    }

    // Check if project has a calendar event
    const { data: project } = await supabase
      .from("projects")
      .select("creator_calendar_event_id")
      .eq("id", projectId)
      .single();

    if (!project?.creator_calendar_event_id) {
      // No calendar event to remove
      return { success: true, message: "No calendar event to remove" };
    }

    // Delete from Google Calendar directly
    const deleted = await deleteGoogleCalendarEvent(
      user.id,
      project.creator_calendar_event_id
    );

    if (!deleted) {
      console.error("Failed to delete calendar event from Google");
      return {
        success: false,
        error: "Failed to remove calendar event",
      };
    }

    // Update database to clear calendar event ID
    await supabase
      .from("projects")
      .update({
        creator_calendar_event_id: null,
        creator_synced_at: null,
      })
      .eq("id", projectId);

    return {
      success: true,
      message: "Calendar event removed successfully",
    };
  } catch (error) {
    console.error("Error removing calendar event:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to remove calendar event",
    };
  }
}

/**
 * Removes calendar event for a signup when it's cancelled.
 * Call this after successfully cancelling a signup.
 * 
 * @param signupId - The ID of the signup that was cancelled
 * @returns Success or error message
 * 
 * @example
 * // After cancelling a signup:
 * const cancelResult = await cancelSignup(signupId);
 * if (cancelResult.success) {
 *   await removeCalendarEventForSignup(signupId);
 * }
 */
export async function removeCalendarEventForSignup(signupId: string) {
  try {
    const supabase = await createClient();

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Error getting user:", userError);
      return { success: false, error: "User not authenticated" };
    }

    // Check if signup has a calendar event
    const { data: signup } = await supabase
      .from("project_signups")
      .select("volunteer_calendar_event_id")
      .eq("id", signupId)
      .single();

    if (!signup?.volunteer_calendar_event_id) {
      // No calendar event to remove
      return { success: true, message: "No calendar event to remove" };
    }

    // Delete from Google Calendar directly
    const deleted = await deleteGoogleCalendarEvent(
      user.id,
      signup.volunteer_calendar_event_id
    );

    if (!deleted) {
      console.error("Failed to delete calendar event from Google");
      return {
        success: false,
        error: "Failed to remove calendar event",
      };
    }

    // Update database to clear calendar event ID
    await supabase
      .from("project_signups")
      .update({
        volunteer_calendar_event_id: null,
        volunteer_synced_at: null,
      })
      .eq("id", signupId);

    return {
      success: true,
      message: "Calendar event removed successfully",
    };
  } catch (error) {
    console.error("Error removing calendar event:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to remove calendar event",
    };
  }
}

/**
 * Removes all volunteer calendar events when a project is cancelled.
 * This removes calendar events for all volunteers who signed up.
 * 
 * @param projectId - The ID of the project that was cancelled
 * @returns Success or error message with count of removed events
 */
export async function removeAllVolunteerCalendarEvents(projectId: string) {
  try {
    const supabase = await createClient();

    // Get all signups with calendar events for this project
    const { data: signups, error } = await supabase
      .from("project_signups")
      .select("id, volunteer_calendar_event_id")
      .eq("project_id", projectId)
      .not("volunteer_calendar_event_id", "is", null);

    if (error) {
      console.error("Error fetching signups:", error);
      return {
        success: false,
        error: "Failed to fetch volunteer signups",
      };
    }

    if (!signups || signups.length === 0) {
      return {
        success: true,
        message: "No volunteer calendar events to remove",
        removedCount: 0,
      };
    }

    // Remove each calendar event
    let removedCount = 0;
    let failedCount = 0;

    for (const signup of signups) {
      const result = await removeCalendarEventForSignup(signup.id);
      if (result.success) {
        removedCount++;
      } else {
        failedCount++;
      }
    }

    return {
      success: failedCount === 0,
      message: `Removed ${removedCount} volunteer calendar events${failedCount > 0 ? `, ${failedCount} failed` : ""}`,
      removedCount,
      failedCount,
    };
  } catch (error) {
    console.error("Error removing volunteer calendar events:", error);
    return {
      success: false,
      error: "Failed to remove volunteer calendar events",
    };
  }
}
