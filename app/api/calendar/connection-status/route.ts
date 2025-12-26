/**
 * Get Calendar Connection Status
 * GET /api/calendar/connection-status
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { getCalendarConnection } from "@/services/calendar";

export async function GET(_request: Request) {
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

    const connection = await getCalendarConnection(user.id);

    if (!connection) {
      return NextResponse.json({
        connected: false,
      });
    }

    return NextResponse.json({
      connected: true,
      provider: connection.provider,
      calendar_email: connection.calendar_email,
      connected_at: connection.connected_at,
      last_synced_at: connection.last_synced_at,
      preferences: connection.preferences,
    });
  } catch (error) {
    console.error("Error getting calendar connection status:", error);
    return NextResponse.json(
      { error: "Failed to get connection status" },
      { status: 500 }
    );
  }
}
