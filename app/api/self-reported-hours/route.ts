import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseSelfReportedHours } from "@/lib/certificates/self-reported-hours";

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

    const input: unknown = await request.json().catch(() => null);
    const parsed = parseSelfReportedHours(input);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.data;

    // Prepare row for certificates table (self-reported)
    const certificateRow = {
      project_id: null,
      user_id: user.id,
      signup_id: null,
      volunteer_name:
        (user.user_metadata as { full_name?: string } | null)?.full_name ||
        null,
      volunteer_email: user.email,
      project_title: body.title,
      project_location: null,
      event_start: parsed.eventStart,
      event_end: parsed.eventEnd,
      organization_name: body.organizationName || null,
      creator_name: body.creatorName,
      is_certified: false,
      creator_id: user.id,
      check_in_method: "self_report",
      schedule_id: null,
      type: "self-reported" as const,
      description: body.description || null,
    } as const;

    const { data, error } = await supabase
      .from("certificates")
      .insert(certificateRow)
      .select(
        "id, project_title, event_start, event_end, organization_name, type, volunteer_name",
      )
      .single();

    if (error) {
      console.error("Error inserting self-reported hours:", error);
      return NextResponse.json(
        { error: "Database insert failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, certificate: data });
  } catch (err) {
    console.error("Unexpected error in self-reported-hours POST:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
