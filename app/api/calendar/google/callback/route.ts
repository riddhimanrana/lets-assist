/**
 * Google Calendar OAuth - Handle Callback
 * GET /api/calendar/google/callback
 */

import { createClient } from "@/lib/supabase/server";
import {
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  verifyGoogleOAuthState,
} from "@/lib/auth/google-oauth-state";
import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";
import { ensureOrganizationCalendar } from "@/services/calendar";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  pickBestExistingGoogleConnection,
  type ExistingGoogleConnection,
} from "./connection-selection";

function getCallbackBaseUrl(request: NextRequest): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (configuredSiteUrl) {
    try {
      return new URL(configuredSiteUrl).origin;
    } catch {
      // Fall back to the request origin when local configuration is malformed.
    }
  }

  return request.nextUrl.origin;
}

function redirectAndConsumeOAuthState(destination: string | URL): NextResponse {
  const response = NextResponse.redirect(destination);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE_NAME, "", {
    ...getGoogleOAuthStateCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

function buildCallbackRedirect(
  baseUrl: string,
  returnTo: string | null,
  result: { error?: string; success?: string; email?: string },
): URL {
  const redirectUrl = new URL(returnTo || "/account/calendar", baseUrl);

  if (result.error) {
    redirectUrl.searchParams.set("error", result.error);
  }
  if (result.success) {
    redirectUrl.searchParams.set("success", result.success);
  }
  if (result.email) {
    redirectUrl.searchParams.set("email", result.email);
  }

  return redirectUrl;
}

export async function GET(request: NextRequest) {
  const baseUrl = getCallbackBaseUrl(request);

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    const stateVerification = verifyGoogleOAuthState({
      state,
      cookieNonce: request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE_NAME)?.value,
      currentUserId: user?.id,
    });

    if (authError || !user || !stateVerification.ok) {
      if (stateVerification.ok === false) {
        console.warn(
          "Rejected Google OAuth callback state:",
          stateVerification.reason,
        );
      }

      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, null, {
          error: authError || !user ? "unauthorized" : "invalid_state",
        }),
      );
    }

    const stateData = stateVerification.payload;

    // Handle user denial
    if (error) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "access_denied",
        }),
      );
    }

    if (!code) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "invalid_request",
        }),
      );
    }

    const userId = user.id;

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
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "token_exchange_failed",
        }),
      );
    }

    const tokens = await tokenResponse.json();
    const grantedScopes = typeof tokens.scope === "string" ? tokens.scope : null;
    const grantedScopesUpdatedAt = grantedScopes ? new Date().toISOString() : null;

    // Determine connection type based on granted scopes
    const hasSheetsScopes =
      !!grantedScopes &&
      grantedScopes.includes("https://www.googleapis.com/auth/drive.file");
    const hasCalendarScopes = grantedScopes && grantedScopes.includes("calendar");
    const connectionType: "calendar" | "sheets" | "both" =
      hasSheetsScopes && hasCalendarScopes
        ? "both"
        : hasSheetsScopes
          ? "sheets"
          : "calendar";

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
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "failed_to_get_email",
        }),
      );
    }

    const userInfo = await userInfoResponse.json();
    const calendarEmail = userInfo.email;

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Check if user already has any Google connection, including inactive rows.
    // This preserves stored preferences (e.g., volunteering_calendar_id)
    // when users disconnect and later reconnect.
    const { data: existingConnections } = (await supabase
      .from("user_calendar_connections")
      .select("id, refresh_token, connection_type, updated_at, connected_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .order("updated_at", { ascending: false })
      .order("connected_at", { ascending: false })) as {
      data: ExistingGoogleConnection[] | null;
    };

    const existingConnection = pickBestExistingGoogleConnection(
      existingConnections,
      connectionType
    );

    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : existingConnection?.refresh_token || null;

    if (!encryptedRefreshToken) {
      console.error("No refresh token available");
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "no_refresh_token",
        }),
      );
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
        return redirectAndConsumeOAuthState(
          buildCallbackRedirect(baseUrl, stateData.returnTo, {
            error: "connection_failed",
          }),
        );
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
        return redirectAndConsumeOAuthState(
          buildCallbackRedirect(baseUrl, stateData.returnTo, {
            error: "connection_failed",
          }),
        );
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
        return redirectAndConsumeOAuthState(
          buildCallbackRedirect(
            baseUrl,
            stateData.returnTo || `/organization/${stateData.orgId}/settings`,
            { error: "org_admin_required" },
          ),
        );
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
          return redirectAndConsumeOAuthState(
            buildCallbackRedirect(
              baseUrl,
              stateData.returnTo || `/organization/${stateData.orgId}/settings`,
              { error: "org_calendar_failed" },
            ),
          );
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
      
      // Handle organization sheets sync ownership separately.
      // Destination/configuration is created in sheets-actions.ts, not in OAuth callback.
      if (stateData.isSheetsSync && stateData.orgId) {
        const { data: existingSync, error: existingSyncError } = await serviceSupabase
          .from("organization_sheet_syncs")
          .select("id")
          .eq("organization_id", stateData.orgId)
          .maybeSingle();

        if (existingSyncError) {
          console.error("Failed to look up organization sheet sync during OAuth callback:", existingSyncError);
        } else if (existingSync) {
          const { error: ownerUpdateError } = await serviceSupabase
            .from("organization_sheet_syncs")
            .update({
              created_by: userId,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", stateData.orgId);

          if (ownerUpdateError) {
            console.error("Failed to update organization sheet sync owner during OAuth callback:", ownerUpdateError);
          }
        }
      }
    }

    return redirectAndConsumeOAuthState(
      buildCallbackRedirect(baseUrl, stateData.returnTo, {
        success: "connected",
        email: calendarEmail,
      }),
    );
  } catch (error) {
    console.error("Error in Google Calendar callback:", error);
    return redirectAndConsumeOAuthState(
      buildCallbackRedirect(baseUrl, null, { error: "unknown" }),
    );
  }
}
