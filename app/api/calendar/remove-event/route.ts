/**
 * Remove Event from Calendar
 * DELETE /api/calendar/remove-event
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { deleteGoogleCalendarEvent } from "@/services/calendar";
import { removeCalendarEventSchema } from "@/schemas/calendar-schema";

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Validate request body
    const body = await request.json();
    const validation = removeCalendarEventSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { event_id, event_type } = validation.data;

    // Delete from Google Calendar
    const deleted = await deleteGoogleCalendarEvent(user.id, event_id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete calendar event" },
        { status: 500 }
      );
    }

    // Update database based on event type
    if (event_type === "creator") {
      await supabase
        .from("projects")
        .update({
          creator_calendar_event_id: null,
          creator_synced_at: null,
        })
        .eq("creator_id", user.id)
        .eq("creator_calendar_event_id", event_id);
    } else {
      await supabase
        .from("project_signups")
        .update({
          volunteer_calendar_event_id: null,
          volunteer_synced_at: null,
        })
        .eq("user_id", user.id)
        .eq("volunteer_calendar_event_id", event_id);
    }

    return NextResponse.json({
      success: true,
      message: "Event removed from calendar successfully",
    });
  } catch (error) {
    console.error("Error removing event from calendar:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("No valid calendar connection")) {
        return NextResponse.json(
          { error: "No active calendar connection found" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to remove event from calendar" },
      { status: 500 }
    );
  }
}
