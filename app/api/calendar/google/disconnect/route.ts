/**
 * Google Calendar - Disconnect
 * POST /api/calendar/google/disconnect
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { deactivateGoogleConnection } from "@/services/calendar";

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

    // Try to parse request body, default to revoking access if no body provided
    let revoke_access = true;
    try {
      const body = await request.json();
      revoke_access = body.revoke_access ?? true;
    } catch {
      // No body provided, use default
    }

    const deactivateResult = await deactivateGoogleConnection(user.id, {
      revokeAccess: revoke_access,
    });
    if (!deactivateResult.success) {
      return NextResponse.json(
        { error: deactivateResult.error || "Failed to disconnect calendar" },
        {
          status:
            deactivateResult.error === "No active Google connection found"
              ? 404
              : 500,
        },
      );
    }

    // Also clear calendar event IDs from projects and signups created by this user
    // Projects
    await supabase
      .from("projects")
      .update({
        creator_calendar_event_id: null,
        creator_synced_at: null,
      })
      .eq("creator_id", user.id)
      .not("creator_calendar_event_id", "is", null);

    // Signups
    await supabase
      .from("project_signups")
      .update({
        volunteer_calendar_event_id: null,
        volunteer_synced_at: null,
      })
      .eq("user_id", user.id)
      .not("volunteer_calendar_event_id", "is", null);

    return NextResponse.json({
      success: true,
      message: "Calendar disconnected successfully",
      remoteRevocation: deactivateResult.remoteRevocation,
    });
  } catch (error) {
    console.error("Error disconnecting calendar:", error);
    return NextResponse.json(
      { error: "Failed to disconnect calendar" },
      { status: 500 }
    );
  }
}
