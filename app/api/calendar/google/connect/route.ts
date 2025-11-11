/**
 * Google Calendar OAuth - Initiate Connection
 * GET /api/calendar/google/connect
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get("return_to");

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
      })
    ).toString("base64");

    // Build Google OAuth URL
    // IMPORTANT: redirect_uri must exactly match what's configured in Google Cloud Console
    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri); // Use exact URI from env
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "consent"); // Force consent to get refresh token
    googleAuthUrl.searchParams.set("state", state);

    return NextResponse.json({
      authUrl: googleAuthUrl.toString(),
    });
  } catch (error) {
    console.error("Error initiating Google Calendar connection:", error);
    return NextResponse.json(
      { error: "Failed to initiate calendar connection" },
      { status: 500 }
    );
  }
}
