"use server";
import { z } from "zod";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { safeConsole } from "@/lib/safe-console";

import { createClient } from "@/lib/supabase/server";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";
import type { Project } from "@/types";

type CalendarHelperResult =
  | { success: true; message: string }
  | {
      success: false;
      error: string;
      code?: "unauthenticated" | "not_found" | "not_owner" | "conflict";
      retryable?: boolean;
    };

const sourceIdSchema = z.string().uuid();

/** Every helper here is a public Server Action, so each one derives its own actor. */
async function authenticate() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return error || !user ? null : { supabase, user };
}

const UNAUTHENTICATED: CalendarHelperResult = {
  success: false,
  error: "User not authenticated",
  code: "unauthenticated",
};

function calendarFailure(
  error: unknown,
  fallback: string,
): CalendarHelperResult {
  if (error instanceof CalendarSyncError) {
    return {
      success: false,
      error: error.message,
      retryable: error.status === 409 || error.status >= 500,
    };
  }
  // Provider and credential errors can carry details that do not belong in logs.
  safeConsole.error(fallback);
  return { success: false, error: fallback, retryable: true };
}

/**
 * Remove the actor's own calendar entry through its durable receipt. A source
 * row without a marker, or no source row at all, is not proof that nothing is
 * left at Google: only a receipt already saved for this actor names the event.
 * `narrowTo` is a caller's claim about which event it means. It never selects
 * an event; it can only refuse when the resolved one differs.
 */
async function removeOwnCalendarEntry(
  userId: string,
  sourceKind: "project" | "signup",
  sourceId: string,
  eventId: string | null,
  narrowTo?: string,
): Promise<CalendarHelperResult> {
  let expectedEventId = eventId;
  if (!expectedEventId) {
    const { findPersonalCalendarReceiptEvent } =
      await import("@/services/personal-calendar/cleanup");
    try {
      expectedEventId = await findPersonalCalendarReceiptEvent(
        userId,
        sourceKind,
        sourceId,
      );
    } catch {
      // An unconfirmed lookup is not proof that nothing is left at Google.
      return {
        success: false,
        error:
          "Calendar cleanup could not be confirmed. Check your calendar settings for entries that still need removing.",
        retryable: true,
      };
    }
    // The exact lookup found no unresolved receipt owned by this actor.
    if (!expectedEventId) {
      return { success: true, message: "No calendar event to remove" };
    }
  }
  if (narrowTo !== undefined && narrowTo !== expectedEventId) {
    return {
      success: false,
      error: "The calendar event changed. Refresh and try again.",
      code: "conflict",
    };
  }
  const { synchronizePersonalCalendar } =
    await import("@/services/personal-calendar");
  await synchronizePersonalCalendar({
    userId,
    sourceKind,
    sourceId,
    operation: "remove",
    expectedEventId,
  });
  return { success: true, message: "Calendar event removed successfully" };
}

/**
 * Updates the creator's calendar event when a project is edited.
 * Call this after successfully updating a project in the database.
 *
 * The actor comes from the session and the project is read again here, so
 * nothing the browser sends decides what is written. A project that was never
 * synced is left alone: the durable claim reports that without provider work.
 *
 * @param projectId - The ID of the project that was updated
 * @returns Success or error message
 *
 * @example
 * // After updating a project:
 * const updateResult = await updateProject(projectId, updatedData);
 * if (updateResult.success) {
 *   const calendarResult = await updateCalendarEventForProject(projectId);
 *   if (!calendarResult.success) showCalendarWarning(calendarResult.error);
 * }
 */
export async function updateCalendarEventForProject(
  projectId: string,
): Promise<CalendarHelperResult> {
  try {
    const session = await authenticate();
    if (!session) return UNAUTHENTICATED;
    if (!sourceIdSchema.safeParse(projectId).success) {
      return { success: false, error: "Project not found", code: "not_found" };
    }

    const { data, error } = await session.supabase
      .from("projects")
      .select(PROJECT_CLIENT_SELECT)
      .eq("id", projectId)
      .maybeSingle();
    if (error) {
      return {
        success: false,
        error: "Failed to update calendar event",
        retryable: true,
      };
    }
    const project = data as unknown as Project | null;
    if (!project || project.id !== projectId) {
      return { success: false, error: "Project not found", code: "not_found" };
    }
    if (project.creator_id !== session.user.id) {
      return {
        success: false,
        error:
          "Only the project creator can update their Google Calendar entry",
        code: "not_owner",
      };
    }

    // A missing marker does not prove there is no receipt. The durable claim
    // decides: it reports "not synced" without any provider work, or refuses
    // when a saved receipt no longer matches the project.
    const { updatePersonalCalendarProject } =
      await import("@/services/personal-calendar");
    const result = await updatePersonalCalendarProject({
      userId: session.user.id,
      project,
    });
    return {
      success: true,
      message:
        result.phase === "synced"
          ? "Calendar event updated successfully"
          : "No calendar event to update",
    };
  } catch (error) {
    return calendarFailure(error, "Failed to update calendar event");
  }
}

/**
 * Removes the creator's calendar event when a project is cancelled or deleted.
 * Call this after successfully cancelling a project, or before deleting it.
 *
 * `deletionSnapshot` never grants authority. It can only narrow the signed-in
 * creator's own request: a different user is refused, and so is an event that
 * differs from the one resolved from the project or the creator's own receipt.
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
export async function removeCalendarEventForProject(
  projectId: string,
  deletionSnapshot?: { userId: string; calendarEventId: string },
): Promise<CalendarHelperResult> {
  try {
    const session = await authenticate();
    if (!session) return UNAUTHENTICATED;
    if (!sourceIdSchema.safeParse(projectId).success) {
      return { success: false, error: "Project not found", code: "not_found" };
    }
    if (deletionSnapshot && deletionSnapshot.userId !== session.user.id) {
      return {
        success: false,
        error: "Only the project creator can remove their calendar event",
        code: "not_owner",
      };
    }

    const { data: project, error } = await session.supabase
      .from("projects")
      .select("id, creator_id, creator_calendar_event_id")
      .eq("id", projectId)
      .maybeSingle();
    if (error) {
      return {
        success: false,
        error: "Failed to remove calendar event",
        retryable: true,
      };
    }
    if (project && project.creator_id !== session.user.id) {
      return {
        success: false,
        error: "Only the project creator can remove their calendar event",
        code: "not_owner",
      };
    }

    return await removeOwnCalendarEntry(
      session.user.id,
      "project",
      projectId,
      project?.creator_calendar_event_id ?? null,
      deletionSnapshot?.calendarEventId,
    );
  } catch (error) {
    return calendarFailure(error, "Failed to remove calendar event");
  }
}

/**
 * Removes the volunteer's own calendar event when their signup is cancelled.
 * Call this after successfully cancelling a signup.
 *
 * Only the volunteer who owns the signup can remove it. An organizer who
 * cancels someone else's signup gets a refusal, not a write with their own
 * credentials.
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
export async function removeCalendarEventForSignup(
  signupId: string,
): Promise<CalendarHelperResult> {
  try {
    const session = await authenticate();
    if (!session) return UNAUTHENTICATED;
    if (!sourceIdSchema.safeParse(signupId).success) {
      return { success: false, error: "Signup not found", code: "not_found" };
    }

    const { data: signup, error } = await session.supabase
      .from("project_signups")
      .select("id, user_id, volunteer_calendar_event_id")
      .eq("id", signupId)
      .maybeSingle();
    if (error) {
      return {
        success: false,
        error: "Failed to remove calendar event",
        retryable: true,
      };
    }
    if (signup && signup.user_id !== session.user.id) {
      return {
        success: false,
        error: "Only the volunteer can remove their calendar event",
        code: "not_owner",
      };
    }

    return await removeOwnCalendarEntry(
      session.user.id,
      "signup",
      signupId,
      signup?.volunteer_calendar_event_id ?? null,
    );
  } catch (error) {
    return calendarFailure(error, "Failed to remove calendar event");
  }
}

/**
 * Removes the signed-in volunteer's own calendar events for a project.
 *
 * This does not reach other volunteers' calendars: each removal goes through
 * `removeCalendarEventForSignup`, which refuses signups the actor does not own
 * and counts them as failed.
 *
 * @param projectId - The ID of the project that was cancelled
 * @returns Success or error message with count of removed events
 */
export async function removeAllVolunteerCalendarEvents(projectId: string) {
  try {
    const session = await authenticate();
    if (!session) return UNAUTHENTICATED;
    if (!sourceIdSchema.safeParse(projectId).success) {
      return { success: false, error: "Project not found" };
    }

    // Get all signups with calendar events for this project
    const { data: signups, error } = await session.supabase
      .from("project_signups")
      .select("id, volunteer_calendar_event_id")
      .eq("project_id", projectId)
      .not("volunteer_calendar_event_id", "is", null);

    if (error) {
      safeConsole.error("Error fetching signups:", error);
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
    safeConsole.error("Error removing volunteer calendar events:", error);
    return {
      success: false,
      error: "Failed to remove volunteer calendar events",
    };
  }
}
