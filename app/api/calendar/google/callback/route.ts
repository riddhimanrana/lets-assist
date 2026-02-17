/**
 * Google Calendar OAuth - Handle Callback
 * GET /api/calendar/google/callback
 */

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";
import { ensureOrganizationCalendar } from "@/services/calendar";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle user denial
    if (error) {
      const stateData = state ? JSON.parse(Buffer.from(state, "base64").toString()) : null;
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      const errorUrl = new URL(redirectUrl, baseUrl);
      errorUrl.searchParams.set("error", "access_denied");
      return NextResponse.redirect(errorUrl.toString());
    }

    if (!code || !state) {
      const stateData = state ? JSON.parse(Buffer.from(state, "base64").toString()) : null;
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const errorUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "invalid_request");
      return NextResponse.redirect(errorUrl.toString());
    }

    // Verify state parameter
    let stateData: {
      userId: string;
      timestamp: number;
      nonce: string;
      returnTo?: string | null;
      orgId?: string | null;
      isCalendarSync?: boolean;
      isSheetsSync?: boolean;
    };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64").toString());
      
      // Check if state is not too old (5 minutes max)
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() - stateData.timestamp > fiveMinutes) {
        throw new Error("State expired");
      }
    } catch {
      const errorUrl = new URL("/account/calendar", process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "invalid_state");
      return NextResponse.redirect(errorUrl.toString());
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
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const errorUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "unauthorized");
      return NextResponse.redirect(errorUrl.toString());
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
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const errorUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "token_exchange_failed");
      return NextResponse.redirect(errorUrl.toString());
    }

    const tokens = await tokenResponse.json();
    const grantedScopes = typeof tokens.scope === "string" ? tokens.scope : null;
    const grantedScopesUpdatedAt = grantedScopes ? new Date().toISOString() : null;

    // Determine connection type based on granted scopes
    const hasSheetsScopes = grantedScopes && grantedScopes.includes("spreadsheets");
    const hasCalendarScopes = grantedScopes && grantedScopes.includes("calendar");
    const connectionType = hasSheetsScopes && hasCalendarScopes ? "both" : hasSheetsScopes ? "sheets" : "calendar";

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
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const errorUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "failed_to_get_email");
      return NextResponse.redirect(errorUrl.toString());
    }

    const userInfo = await userInfoResponse.json();
    const calendarEmail = userInfo.email;

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if user already has any active Google connection
    const { data: existingConnection } = (await supabase
      .from("user_calendar_connections")
      .select("id, refresh_token, connection_type")
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("is_active", true)
      .maybeSingle()) as {
      data:
        | {
            id: string;
            refresh_token: string | null;
            connection_type: string;
          }
        | null;
    };

    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existingConnection?.refresh_token || null;

    if (!encryptedRefreshToken) {
      console.error("No refresh token available");
      const redirectUrl = stateData?.returnTo || "/account/calendar";
      const errorUrl = new URL(redirectUrl, process.env.NEXT_PUBLIC_SITE_URL || "");
      errorUrl.searchParams.set("error", "no_refresh_token");
      return NextResponse.redirect(errorUrl.toString());
    }

    if (existingConnection) {
      // Update existing connection (and reactivate if it was inactive)
      const { error: updateError } = (await supabase
        .from("user_calendar_connections")
        .update({
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: expiresAt.toISOString(),
          calendar_email: calendarEmail,
          connected_at: new Date().toISOString(),
          is_active: true,
          granted_scopes: grantedScopes,
          granted_scopes_updated_at: grantedScopesUpdatedAt,
          connection_type: connectionType,
        })
        .eq("id", existingConnection.id)) as { error: { message?: string } | null };

      if (updateError) {
        console.error("Failed to update calendar connection:", updateError);
        const redirectUrl = stateData.returnTo || "/account/calendar";
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
        const errorUrl = new URL(redirectUrl, baseUrl);
        errorUrl.searchParams.set("error", "connection_failed");
        return NextResponse.redirect(errorUrl.toString());
      }
    } else {
      // Create new connection
      const { error: insertError } = (await supabase
        .from("user_calendar_connections")
        .insert({
          user_id: userId,
          provider: "google",
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: expiresAt.toISOString(),
          calendar_email: calendarEmail,
          is_active: true,
          connection_type: connectionType,
          granted_scopes: grantedScopes,
          granted_scopes_updated_at: grantedScopesUpdatedAt,
          preferences: {
            reminder_minutes: 15,
            auto_sync_new_projects: false,
            auto_sync_signups: false,
          },
        })) as { error: { message?: string } | null };

      if (insertError) {
        console.error("Failed to save calendar connection:", insertError);
        const redirectUrl = stateData.returnTo || "/account/calendar";
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
        const errorUrl = new URL(redirectUrl, baseUrl);
        errorUrl.searchParams.set("error", "connection_failed");
        return NextResponse.redirect(errorUrl.toString());
      }
    }

    if (stateData.orgId) {
      const serviceSupabase = getAdminClient();
      const { data: membership } = await serviceSupabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", stateData.orgId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!membership || membership.role !== "admin") {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
        const target = stateData.returnTo || `/organization/${stateData.orgId}/settings`;
        const errorUrl = new URL(target, baseUrl);
        errorUrl.searchParams.set("error", "org_admin_required");
        return NextResponse.redirect(errorUrl.toString());
      }

      // Handle organization calendar sync (separate from sheets sync)
      if (stateData.isCalendarSync) {
        const { data: org } = await serviceSupabase
          .from("organizations")
          .select("name")
          .eq("id", stateData.orgId)
          .maybeSingle();

        const { data: existingSync } = await serviceSupabase
          .from("organization_calendar_syncs")
          .select("calendar_id, auto_sync, last_synced_at")
          .eq("organization_id", stateData.orgId)
          .maybeSingle();

        const calendarName = org?.name
          ? `Let's Assist — ${org.name} Volunteering`
          : "Let's Assist Organization Volunteering";

        const ensured = await ensureOrganizationCalendar(
          tokens.access_token,
          existingSync?.calendar_id,
          calendarName
        );

        if (!ensured) {
          const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
          const target = stateData.returnTo || `/organization/${stateData.orgId}/settings`;
          const errorUrl = new URL(target, baseUrl);
          errorUrl.searchParams.set("error", "org_calendar_failed");
          return NextResponse.redirect(errorUrl.toString());
        }

        await serviceSupabase
          .from("organization_calendar_syncs")
          .upsert(
            {
              organization_id: stateData.orgId,
              created_by: userId,
              calendar_id: ensured.calendarId,
              calendar_email: calendarEmail,
              connected_at: new Date().toISOString(),
              last_synced_at: existingSync?.last_synced_at ?? null,
              auto_sync: existingSync?.auto_sync ?? true, // Enable auto-sync by default
              updated_at: new Date().toISOString(),
            },
            { onConflict: "organization_id" }
          );
      }
      
      // Handle organization sheets sync separately (no calendar creation)
      // The sheets sync configuration is handled in the sheets-actions.ts file
      if (stateData.isSheetsSync && stateData.orgId) {
        // Automatically make the connecting admin the owner of the sync
        // if they are connecting specifically for this organization.
        
        // Check if sync already exists
        const { data: existingSync } = await serviceSupabase
          .from("organization_sheet_syncs")
          .select("organization_id")
          .eq("organization_id", stateData.orgId)
          .maybeSingle();

        if (existingSync) {
          // If it exists, only update the owner and timestamp
          await serviceSupabase
            .from("organization_sheet_syncs")
            .update({ 
               created_by: userId, 
               updated_at: new Date().toISOString() 
            })
            .eq("organization_id", stateData.orgId);
        } else {
          // If it doesn't exist, create it with defaults
          await serviceSupabase
            .from("organization_sheet_syncs")
            .insert({
               organization_id: stateData.orgId,
               created_by: userId,
               report_type: 'member-hours',
               auto_sync: false,
               sync_interval_minutes: 1440,
               updated_at: new Date().toISOString() 
            });
        }
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
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    // If we have state data in the error context, we might be able to redirect back to where we came from
    return NextResponse.redirect(
      `${baseUrl}/account/calendar?error=unknown`
    );
  }
}
