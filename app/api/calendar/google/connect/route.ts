/**
 * Google Calendar OAuth - Initiate Connection
 * GET /api/calendar/google/connect
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get("return_to");
    const scopeType = searchParams.get("scopes") || "calendar"; // "calendar" | "sheets" | "both"
    const forceConsent = searchParams.get("force") === "1";
    const wantsJson = searchParams.get("format") === "json";
    const orgId = searchParams.get("org_id");
    const isCalendarSync = searchParams.get("calendar_sync") === "1";
    const isSheetsSync = searchParams.get("sheets_sync") === "1";

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

    if (orgId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .single();

      if (!membership || membership.role !== "admin") {
        // Restrict returnTo to same-origin relative paths only
        const safeReturnTo = returnTo && returnTo.startsWith("/") 
          ? returnTo 
          : `/organization/${orgId}/settings`;
        
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
        const redirectUrl = new URL(safeReturnTo, baseUrl);
        redirectUrl.searchParams.set("error", "org_admin_required");
        return NextResponse.redirect(redirectUrl.toString());
      }
    }

    // Get environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      console.error("Missing Google OAuth configuration");
      return NextResponse.json(
        { error: "Calendar integration is not configured" },
        { status: 500 }
      );
    }

    // Generate state parameter for security (prevents CSRF)
    // Include returnTo in the state so we can redirect after OAuth
    const state = Buffer.from(
      JSON.stringify({
        userId: user.id,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7),
        returnTo: returnTo || null,
        orgId: orgId || null,
        isCalendarSync: isCalendarSync || false,
        isSheetsSync: isSheetsSync || false,
      })
    ).toString("base64");

    // Build Google OAuth URL
    // IMPORTANT: redirect_uri must exactly match what's configured in Google Cloud Console
    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri); // Use exact URI from env
    googleAuthUrl.searchParams.set("response_type", "code");
    
    // Always include email scope
    const scopes = ["https://www.googleapis.com/auth/userinfo.email"];
    
    // Determine which scopes to request based on the connection type
    if (scopeType === "sheets" || isSheetsSync) {
      // Sheets-only connection (for organization reports)
      scopes.push(
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
      );
    } else if (scopeType === "both") {
      // Both calendar and sheets (rare case)
      scopes.push(
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
      );
    } else {
      // Default to calendar-only (for organization calendar sync or personal calendar)
      scopes.push("https://www.googleapis.com/auth/calendar");
    }

    googleAuthUrl.searchParams.set("scope", scopes.join(" "));
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("include_granted_scopes", "true");
    googleAuthUrl.searchParams.set(
      "prompt",
      forceConsent ? "consent" : "select_account"
    ); // Force consent to get refresh token
    googleAuthUrl.searchParams.set("state", state);

    if (wantsJson) {
      return NextResponse.json({
        authUrl: googleAuthUrl.toString(),
      });
    }

    return NextResponse.redirect(googleAuthUrl.toString());
  } catch (error) {
    console.error("Error initiating Google Calendar connection:", error);
    return NextResponse.json(
      { error: "Failed to initiate calendar connection" },
      { status: 500 }
    );
  }
}
