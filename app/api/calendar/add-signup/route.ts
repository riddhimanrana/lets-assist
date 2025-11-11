/**
 * Add Signup to Calendar
 * POST /api/calendar/add-signup
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { createGoogleCalendarEvent } from "@/services/calendar";
import { syncSignupSchema } from "@/schemas/calendar-schema";

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
    const validation = syncSignupSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { signup_id, project_id, schedule_id } = validation.data;

    // Get the signup
    const { data: signup, error: signupError } = await supabase
      .from("project_signups")
      .select("*")
      .eq("id", signup_id)
      .eq("user_id", user.id)
      .single();

    if (signupError || !signup) {
      return NextResponse.json(
        { error: "Signup not found" },
        { status: 404 }
      );
    }

    // Check if already synced
    if (signup.volunteer_calendar_event_id) {
      return NextResponse.json(
        { error: "Signup is already synced to calendar" },
        { status: 400 }
      );
    }

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

    // Create calendar event
    const eventId = await createGoogleCalendarEvent(
      user.id,
      project,
      schedule_id
    );

    if (!eventId) {
      return NextResponse.json(
        { error: "Failed to create calendar event" },
        { status: 500 }
      );
    }

    // Update signup with calendar event ID
    const { error: updateError } = await supabase
      .from("project_signups")
      .update({
        volunteer_calendar_event_id: eventId,
        volunteer_synced_at: new Date().toISOString(),
      })
      .eq("id", signup_id);

    if (updateError) {
      console.error("Failed to update signup:", updateError);
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
      message: "Signup added to calendar successfully",
    });
  } catch (error) {
    console.error("Error adding signup to calendar:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("No valid calendar connection")) {
        return NextResponse.json(
          { error: "Please connect your Google Calendar first" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to add signup to calendar" },
      { status: 500 }
    );
  }
}
