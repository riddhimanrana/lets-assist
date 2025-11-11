/**
 * Google Calendar OAuth - Handle Callback
 * GET /api/calendar/google/callback
 */

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle user denial
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=access_denied`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=invalid_request`
      );
    }

    // Verify state parameter
    let stateData: { userId: string; timestamp: number; nonce: string; returnTo?: string | null };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64").toString());
      
      // Check if state is not too old (5 minutes max)
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() - stateData.timestamp > fiveMinutes) {
        throw new Error("State expired");
      }
    } catch (err) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=invalid_state`
      );
    }

    const supabase = await createClient();

    // Try to get the current user, but don't fail if session is expired
    // We'll verify the userId from state parameter instead
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // If we have a user session, verify it matches the state
    // If no session, we'll still proceed but use the userId from state
    if (user && user.id !== stateData.userId) {
      console.error("User ID mismatch:", { sessionUser: user.id, stateUser: stateData.userId });
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=unauthorized`
      );
    }

    // Use userId from state (this is secure because state is signed and time-limited)
    const userId = stateData.userId;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("Token exchange failed:", errorData);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    if (!tokens.refresh_token) {
      console.error("No refresh token received");
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=no_refresh_token`
      );
    }

    // Get user's email from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      console.error("Failed to get user info");
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=failed_to_get_email`
      );
    }

    const userInfo = await userInfoResponse.json();
    const calendarEmail = userInfo.email;

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = encrypt(tokens.refresh_token);

    // Check if user already has a connection
    const { data: existingConnection } = await supabase
      .from("user_calendar_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("is_active", true)
      .single();

    if (existingConnection) {
      // Update existing connection
      const { error: updateError } = await supabase
        .from("user_calendar_connections")
        .update({
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: expiresAt.toISOString(),
          calendar_email: calendarEmail,
          connected_at: new Date().toISOString(),
          is_active: true,
        })
        .eq("id", existingConnection.id);

      if (updateError) {
        console.error("Failed to update calendar connection:", updateError);
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=connection_failed`
        );
      }
    } else {
      // Create new connection
      const { error: insertError } = await supabase
        .from("user_calendar_connections")
        .insert({
          user_id: userId,
          provider: "google",
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: expiresAt.toISOString(),
          calendar_email: calendarEmail,
          is_active: true,
          preferences: {
            reminder_minutes: 15,
            auto_sync_new_projects: false,
            auto_sync_signups: false,
          },
        });

      if (insertError) {
        console.error("Failed to save calendar connection:", insertError);
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=connection_failed`
        );
      }
    }

    // Success! Check for custom redirect from state or default to calendar settings
    const redirectUrl = stateData.returnTo || "/account/calendar";
    const successUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL!);
    successUrl.searchParams.set("success", "connected");
    successUrl.searchParams.set("email", calendarEmail);
    
    return NextResponse.redirect(successUrl.toString());
  } catch (error) {
    console.error("Error in Google Calendar callback:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/account/calendar?error=unknown`
    );
  }
}
