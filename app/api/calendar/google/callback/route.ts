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
import {
  authorizeGoogleOAuthOrganizationRequest,
  googleOAuthAuthorizationError,
} from "@/lib/auth/google-oauth-authorization";
import {
  hasGoogleCalendarWriteScope,
  hasGoogleDriveFileScope,
} from "@/lib/auth/google-oauth-scopes";
import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";
import { ensureOrganizationCalendar } from "@/services/calendar";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getGoogleOAuthConnectionForBinding,
  saveGoogleOAuthConnectionForBinding,
} from "@/lib/auth/google-oauth-connection-store";
import {
  canReuseExistingGoogleRefreshToken,
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
    const authorizationInput = {
      organizationId: stateData.organizationId,
      pluginKey: stateData.pluginKey,
      purpose: stateData.purpose,
      requestedCapability: stateData.requestedCapability,
      userId,
      userEmail: user.email,
    };
    const authorization =
      await authorizeGoogleOAuthOrganizationRequest(authorizationInput);
    if (!authorization.allowed) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: googleOAuthAuthorizationError(
            authorization,
            stateData.purpose,
          ),
        }),
      );
    }

    const binding = {
      purpose: stateData.purpose,
      organizationId: stateData.organizationId,
      pluginKey: stateData.pluginKey,
    };
    // Resolve only through the server-managed signed binding while the initial
    // authorization is fresh. Inactive exact matches may be reactivated;
    // legacy and cross-purpose rows fail closed.
    const existingConnection = await getGoogleOAuthConnectionForBinding(
      userId,
      binding,
      { activeOnly: false, useServiceRole: true },
    );

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
      // Provider response bodies may include grant diagnostics. Keep callback
      // logs limited to non-sensitive transport metadata.
      console.error("Google token exchange failed", {
        status: tokenResponse.status,
      });
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "token_exchange_failed",
        }),
      );
    }

    const tokens = await tokenResponse.json();
    const grantedScopes =
      typeof tokens.scope === "string" ? tokens.scope : null;
    // Determine connection type based on granted scopes
    const hasSheetsScopes = hasGoogleDriveFileScope(grantedScopes);
    const hasCalendarScopes = hasGoogleCalendarWriteScope(grantedScopes);
    const requiresSheetsScopes =
      stateData.purpose === "personal_sheets" ||
      stateData.purpose === "organization_sheets" ||
      stateData.purpose === "csf_import";
    const requiresCalendarScopes =
      stateData.purpose === "personal_calendar" ||
      stateData.purpose === "organization_calendar";
    if (
      (requiresSheetsScopes && !hasSheetsScopes) ||
      (requiresCalendarScopes && !hasCalendarScopes)
    ) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "missing_required_scope",
        }),
      );
    }
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
      },
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
    const calendarEmail =
      typeof userInfo.email === "string" && userInfo.email.trim()
        ? userInfo.email.trim()
        : null;
    if (!calendarEmail) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "failed_to_get_email",
        }),
      );
    }

    // Calculate token expiry
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : canReuseExistingGoogleRefreshToken(existingConnection, calendarEmail)
        ? existingConnection?.refresh_token || null
        : null;

    if (!encryptedRefreshToken) {
      console.error("No refresh token available");
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "no_refresh_token",
        }),
      );
    }

    // Google calls may take long enough for organization membership, plugin
    // availability, or a CSF capability grant to change. Revalidate the signed
    // intent immediately before persistence so a revoked actor cannot create or
    // reactivate a credential using an authorization decision made earlier.
    const finalAuthorization =
      await authorizeGoogleOAuthOrganizationRequest(authorizationInput);
    if (!finalAuthorization.allowed) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: googleOAuthAuthorizationError(
            finalAuthorization,
            stateData.purpose,
          ),
        }),
      );
    }

    const saveResult = await saveGoogleOAuthConnectionForBinding({
      userId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: expiresAt.toISOString(),
      calendarEmail,
      grantedScopes,
      connectionType,
      binding,
      requestedCapability: stateData.requestedCapability,
    });
    if (!saveResult.connectionId) {
      return redirectAndConsumeOAuthState(
        buildCallbackRedirect(baseUrl, stateData.returnTo, {
          error: "connection_failed",
        }),
      );
    }

    if (stateData.organizationId) {
      const serviceSupabase = getAdminClient();

      // Handle organization calendar sync (separate from sheets sync)
      if (stateData.isCalendarSync) {
        const { data: org } = await serviceSupabase
          .from("organizations")
          .select("name")
          .eq("id", stateData.organizationId)
          .maybeSingle();

        const { data: existingSync } = await serviceSupabase
          .from("organization_calendar_syncs")
          .select("calendar_id, auto_sync, last_synced_at")
          .eq("organization_id", stateData.organizationId)
          .maybeSingle();

        const calendarName = org?.name
          ? `Let's Assist — ${org.name} Volunteering`
          : "Let's Assist Organization Volunteering";

        const ensured = await ensureOrganizationCalendar(
          tokens.access_token,
          existingSync?.calendar_id,
          calendarName,
        );

        if (!ensured) {
          return redirectAndConsumeOAuthState(
            buildCallbackRedirect(
              baseUrl,
              stateData.returnTo ||
                `/organization/${stateData.organizationId}/settings`,
              { error: "org_calendar_failed" },
            ),
          );
        }

        await serviceSupabase.from("organization_calendar_syncs").upsert(
          {
            organization_id: stateData.organizationId,
            created_by: userId,
            calendar_id: ensured.calendarId,
            calendar_email: calendarEmail,
            connected_at: new Date().toISOString(),
            last_synced_at: existingSync?.last_synced_at ?? null,
            auto_sync: existingSync?.auto_sync ?? true, // Enable auto-sync by default
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        );
      }

      // Handle organization sheets sync ownership separately.
      // Destination/configuration is created in sheets-actions.ts, not in OAuth callback.
      if (stateData.isSheetsSync) {
        const { data: existingSync, error: existingSyncError } =
          await serviceSupabase
            .from("organization_sheet_syncs")
            .select("id")
            .eq("organization_id", stateData.organizationId)
            .maybeSingle();

        if (existingSyncError) {
          console.error(
            "Failed to look up organization sheet sync during OAuth callback:",
            existingSyncError,
          );
        } else if (existingSync) {
          const { error: ownerUpdateError } = await serviceSupabase
            .from("organization_sheet_syncs")
            .update({
              created_by: userId,
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", stateData.organizationId);

          if (ownerUpdateError) {
            console.error(
              "Failed to update organization sheet sync owner during OAuth callback:",
              ownerUpdateError,
            );
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
