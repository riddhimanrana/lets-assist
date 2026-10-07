import { safeConsole } from "@/lib/safe-console";
/**
 * Sync Project to Calendar
 * POST /api/calendar/sync-project
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  CalendarSyncError,
  synchronizePersonalCalendar,
} from "@/services/personal-calendar";
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate request body
    const body = await request.json().catch(() => null);

    // Support both camelCase (legacy) and snake_case
    const normalizedBody = {
      project_id: body?.project_id || body?.projectId,
      schedule_id: body?.schedule_id || body?.scheduleId,
    };

    const validation = syncProjectSchema.safeParse(normalizedBody);

    if (!validation.success) {
      safeConsole.error(
        "Sync project validation failed:",
        validation.error.issues,
      );
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: validation.error.issues,
          hint: "project_id is required",
        },
        { status: 400 },
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
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user is the creator
    if (project.creator_id !== user.id) {
      return NextResponse.json(
        { error: "Only the project creator can sync to calendar" },
        { status: 403 },
      );
    }

    const { eventId } = await synchronizePersonalCalendar({
      userId: user.id,
      sourceKind: "project",
      sourceId: project_id,
      operation: "sync",
      project,
      scheduleId: schedule_id,
    });

    return NextResponse.json({
      success: true,
      event_id: eventId,
      message: "Project synced to calendar successfully",
    });
  } catch (error) {
    if (error instanceof CalendarSyncError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to sync project to calendar" },
      { status: 500 },
    );
  }
}
