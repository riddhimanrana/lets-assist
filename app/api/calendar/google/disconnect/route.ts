/**
 * Google Calendar - Disconnect
 * POST /api/calendar/google/disconnect
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { decrypt } from "@/lib/encryption";
import { revokeGoogleCalendarAccess } from "@/services/calendar";

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

    // Get the user's connection
    const { data: connection, error: fetchError } = await supabase
      .from("user_calendar_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .eq("is_active", true)
      .single();

    if (fetchError || !connection) {
      return NextResponse.json(
        { error: "No active calendar connection found" },
        { status: 404 }
      );
    }

    // Optionally revoke access with Google
    if (revoke_access) {
      try {
        const decryptedRefreshToken = decrypt(connection.refresh_token);
        await revokeGoogleCalendarAccess(decryptedRefreshToken);
      } catch (_error) {
        console.error("Failed to revoke Google access:", _error);
        // Continue anyway - we still want to deactivate locally
      }
    }

    // Deactivate the connection
    const { error: updateError } = await supabase
      .from("user_calendar_connections")
      .update({ is_active: false })
      .eq("id", connection.id);

    if (updateError) {
      console.error("Failed to deactivate connection:", updateError);
      return NextResponse.json(
        { error: "Failed to disconnect calendar" },
        { status: 500 }
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
    });
  } catch (error) {
    console.error("Error disconnecting calendar:", error);
    return NextResponse.json(
      { error: "Failed to disconnect calendar" },
      { status: 500 }
    );
  }
}
