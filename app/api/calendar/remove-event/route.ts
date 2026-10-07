import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  CalendarSyncError,
  synchronizePersonalCalendar,
} from "@/services/personal-calendar";
import { removeCalendarEventSchema } from "@/schemas/calendar-schema";

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const validation = removeCalendarEventSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!validation.success)
      return NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 },
      );
    // The service-only claim resolves the actor's receipt or legacy owned record atomically.
    await synchronizePersonalCalendar({
      userId: user.id,
      sourceKind:
        validation.data.event_type === "creator" ? "project" : "signup",
      operation: "remove",
      expectedEventId: validation.data.event_id,
    });
    return NextResponse.json({
      success: true,
      message: "Event removed from calendar successfully",
    });
  } catch (error) {
    if (error instanceof CalendarSyncError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    return NextResponse.json(
      { error: "Failed to remove event from calendar" },
      { status: 503 },
    );
  }
}
