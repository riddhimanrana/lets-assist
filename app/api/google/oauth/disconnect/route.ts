import { safeConsole } from "@/lib/safe-console";
/**
 * Google - Disconnect
 * POST /api/google/oauth/disconnect
 *
 * Disconnect the signed-in account's personal calendar purpose.
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { deactivateGoogleConnection } from "@/services/calendar";
import { preparePersonalCalendarDisconnect } from "@/services/personal-calendar/disconnect";
import { CalendarSyncError } from "@/services/personal-calendar/reconcile";

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

    // An empty UI request uses the default; malformed options cannot revoke a grant.
    let revoke_access = true;
    try {
      const text = await request.text();
      if (text.trim()) {
        const body: unknown = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return NextResponse.json(
            { error: "Invalid disconnect options" },
            { status: 400 },
          );
        }
        if ("revoke_access" in body) {
          if (typeof body.revoke_access !== "boolean") {
            return NextResponse.json(
              { error: "Invalid disconnect options" },
              { status: 400 },
            );
          }
          revoke_access = body.revoke_access;
        }
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid disconnect options" },
        { status: 400 },
      );
    }

    const prepared = await preparePersonalCalendarDisconnect(user.id);
    const deactivateResult = await deactivateGoogleConnection(user.id, {
      revokeAccess: revoke_access,
      expectedConnection: {
        id: prepared.connectionId,
        updatedAt: prepared.updatedAt,
      },
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

    return NextResponse.json({
      success: true,
      message: "Calendar disconnected successfully",
      remoteRevocation: deactivateResult.remoteRevocation,
    });
  } catch (error) {
    if (error instanceof CalendarSyncError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    safeConsole.error("Error disconnecting calendar:", error);
    return NextResponse.json(
      { error: "Failed to disconnect calendar" },
      { status: 500 },
    );
  }
}
