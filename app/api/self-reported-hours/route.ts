import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Shape of request body expected from AddVolunteerHoursModal
interface SelfReportedHoursRequest {
  title: string;
  creatorName: string;
  organizationName?: string | null;
  date: string;      // yyyy-MM-dd
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  description?: string | null;
}

export async function POST(request: Request) {
  try {
  // createClient is async in this project; await it to get Supabase client
  const supabase = await createClient();

    // Validate auth (user must be logged in to add self-reported hours)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: SelfReportedHoursRequest = await request.json();

    // Basic validation
    if (!body.title || !body.creatorName || !body.date || !body.startTime || !body.endTime) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Construct start/end ISO timestamps
    const eventStart = new Date(`${body.date}T${body.startTime}:00`);
    const eventEnd = new Date(`${body.date}T${body.endTime}:00`);

    if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
      return NextResponse.json({ error: "Invalid date or time format" }, { status: 400 });
    }

    if (eventEnd <= eventStart) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }

    // Calculate duration (limit to 24h already enforced in client, but double-check)
    const durationMs = eventEnd.getTime() - eventStart.getTime();
    if (durationMs > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Duration cannot exceed 24 hours" }, { status: 400 });
    }

    // Prepare row for certificates table (self-reported)
    const certificateRow = {
      project_id: null,
      user_id: user.id,
      signup_id: null,
      volunteer_name: user.user_metadata?.full_name || null,
      volunteer_email: user.email,
      project_title: body.title.substring(0, 140),
      project_location: null,
      event_start: eventStart.toISOString(),
      event_end: eventEnd.toISOString(),
      organization_name: body.organizationName || null,
      creator_name: body.creatorName,
      is_certified: false,
      creator_id: user.id,
      check_in_method: 'self_report',
      schedule_id: null,
      type: 'self-reported' as const,
      description: body.description || null,
    } as const;

  const { data, error } = await supabase
      .from("certificates")
      .insert(certificateRow)
      .select("id, project_title, event_start, event_end, organization_name, type, volunteer_name")
      .single();

    if (error) {
      console.error("Error inserting self-reported hours:", error);
      return NextResponse.json({ error: "Database insert failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, certificate: data });
  } catch (err) {
    console.error("Unexpected error in self-reported-hours POST:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
