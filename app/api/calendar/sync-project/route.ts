/**
 * Sync Project to Calendar
 * POST /api/calendar/sync-project
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { createGoogleCalendarEvent } from "@/services/calendar";
import { syncProjectSchema } from "@/schemas/calendar-schema";

export async function POST(request: Request) {
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
    const validation = syncProjectSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { project_id, schedule_id } = validation.data;

    // Get the project
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check if user is the creator
    if (project.creator_id !== user.id) {
      return NextResponse.json(
        { error: "Only the project creator can sync to calendar" },
        { status: 403 }
      );
    }

    // Check if already synced
    if (project.creator_calendar_event_id) {
      return NextResponse.json(
        { error: "Project is already synced to calendar" },
        { status: 400 }
      );
    }

    // For one-time events or when schedule_id is provided, create single event
    // For multiDay/sameDayMultiArea without schedule_id, create all events
    const eventId = await createGoogleCalendarEvent(
      user.id,
      project,
      schedule_id // undefined will create all events for multi-day/multi-area
    );

    if (!eventId) {
      return NextResponse.json(
        { error: "Failed to create calendar event" },
        { status: 500 }
      );
    }

    // Update project with calendar event ID
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        creator_calendar_event_id: eventId,
        creator_synced_at: new Date().toISOString(),
      })
      .eq("id", project_id);

    if (updateError) {
      console.error("Failed to update project:", updateError);
      return NextResponse.json(
        { error: "Failed to save sync status" },
        { status: 500 }
      );
    }

    // Update last_synced_at in calendar connection
    await supabase
      .from("user_calendar_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_active", true);

    return NextResponse.json({
      success: true,
      event_id: eventId,
      message: "Project synced to calendar successfully",
    });
  } catch (error) {
    console.error("Error syncing project to calendar:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("No valid calendar connection")) {
        return NextResponse.json(
          { error: "Please connect your Google Calendar first" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to sync project to calendar" },
      { status: 500 }
    );
  }
}
