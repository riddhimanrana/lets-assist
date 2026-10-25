import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
/**
 * Add Signup to Calendar
 * POST /api/calendar/add-signup
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  CalendarSyncError,
  synchronizePersonalCalendar,
} from "@/services/personal-calendar";
import { syncSignupSchema } from "@/schemas/calendar-schema";
import type { Project } from "@/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate request body
    const body = await request.json().catch(() => null);
    const validation = syncSignupSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.issues },
        { status: 400 },
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
      return NextResponse.json({ error: "Signup not found" }, { status: 404 });
    }
    if (
      signup.project_id !== project_id ||
      signup.schedule_id !== schedule_id
    ) {
      return NextResponse.json(
        { error: "Signup does not match the requested project schedule" },
        { status: 400 },
      );
    }

    // Get the project
    const { data: project, error: projectError } = (await supabase
      .from("projects")
      .select(PROJECT_CLIENT_SELECT)
      .eq("id", project_id)
      .single()) as {
      data: Project | null;
      error: { message?: string } | null;
    };

    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { eventId } = await synchronizePersonalCalendar({
      userId: user.id,
      sourceKind: "signup",
      sourceId: signup_id,
      operation: "sync",
      project,
      scheduleId: schedule_id,
    });

    return NextResponse.json({
      success: true,
      event_id: eventId,
      message: "Signup added to calendar successfully",
    });
  } catch (error) {
    if (error instanceof CalendarSyncError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to add signup to calendar" },
      { status: 500 },
    );
  }
}
