/**
 * Google Calendar OAuth - Initiate Connection
 * GET /api/calendar/google/connect
 */

import { createClient } from "@/lib/supabase/server";
import {
  createGoogleOAuthState,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  normalizeGoogleOAuthReturnTo,
} from "@/lib/auth/google-oauth-state";
import {
  authorizeGoogleOAuthOrganizationRequest,
  getGoogleOAuthRequiredScopeFamily,
  googleOAuthAuthorizationError,
  resolveGoogleOAuthRequestIntent,
} from "@/lib/auth/google-oauth-authorization";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import { NextResponse } from "next/server";

function attachGoogleOAuthStateCookie(
  response: NextResponse,
  nonce: string,
): NextResponse {
  response.cookies.set(
    GOOGLE_OAUTH_STATE_COOKIE_NAME,
    nonce,
    getGoogleOAuthStateCookieOptions(),
  );
  return response;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const returnTo = searchParams.get("return_to");
    const scopeType = searchParams.get("scopes") || "calendar"; // "calendar" | "sheets" | "both"
    const forceConsent = searchParams.get("force") === "1";
    const wantsJson = searchParams.get("format") === "json";
    const organizationId =
      searchParams.get("organization_id") ?? searchParams.get("org_id");
    const isCalendarSync = searchParams.get("calendar_sync") === "1";
    const isSheetsSync = searchParams.get("sheets_sync") === "1";
    const intentResult = resolveGoogleOAuthRequestIntent({
      organizationId,
      pluginKey: searchParams.get("plugin_key") ?? searchParams.get("plugin"),
      purpose: searchParams.get("purpose"),
      requestedCapability:
        searchParams.get("requested_capability") ??
        searchParams.get("capability"),
      scopeType,
      isCalendarSync,
      isSheetsSync,
    });

    // Check if user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!intentResult.ok) {
      return NextResponse.json(
        { error: "Invalid Google connection request" },
        { status: 400 },
      );
    }

    const intent = intentResult.intent;
    const authorization = await authorizeGoogleOAuthOrganizationRequest({
      ...intent,
      userId: user.id,
      userEmail: user.email,
    });

    if (!authorization.allowed) {
      const requestUrl = new URL(request.url);
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
      const safeReturnTo = normalizeGoogleOAuthReturnTo(returnTo);
      const target =
        safeReturnTo ||
        (intent.organizationId
          ? `/organization/${intent.organizationId}/settings`
          : "/account/calendar");
      const redirectUrl = new URL(target, baseUrl);
      redirectUrl.searchParams.set(
        "error",
        googleOAuthAuthorizationError(authorization, intent.purpose),
      );
      return NextResponse.redirect(redirectUrl.toString());
    }

    // Get environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      console.error("Missing Google OAuth configuration");
      return NextResponse.json(
        { error: "Calendar integration is not configured" },
        { status: 500 },
      );
    }

    // Bind the OAuth response to this signed-in user and a short-lived,
    // HttpOnly nonce cookie. The callback consumes the cookie exactly once.
    const { state, nonce } = createGoogleOAuthState({
      userId: user.id,
      returnTo,
      organizationId: intent.organizationId,
      pluginKey: intent.pluginKey,
      purpose: intent.purpose,
      requestedCapability: intent.requestedCapability,
    });

    const requiredScopeFamily = getGoogleOAuthRequiredScopeFamily(
      intent.purpose,
    );
    const wantsSheetsScopes = requiredScopeFamily === "sheets";
    const existingConnection = await getGoogleOAuthConnectionForBinding(
      user.id,
      {
        purpose: intent.purpose,
        organizationId: intent.organizationId,
        pluginKey: intent.pluginKey,
      },
    );
    const existingTypeMatches = existingConnection
      ? wantsSheetsScopes
        ? ["sheets", "both"].includes(existingConnection.connection_type ?? "")
        : ["calendar", "both"].includes(existingConnection.connection_type ?? "")
      : false;

    const shouldPromptConsent =
      forceConsent || !existingTypeMatches || !existingConnection?.refresh_token;

    const sheetsScopes = ["https://www.googleapis.com/auth/drive.file"];

    // Build Google OAuth URL
    // IMPORTANT: redirect_uri must exactly match what's configured in Google Cloud Console
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri); // Use exact URI from env
    googleAuthUrl.searchParams.set("response_type", "code");

    // Always include email scope
    const scopes = ["https://www.googleapis.com/auth/userinfo.email"];

    // The signed purpose, not a second query alias, determines OAuth scope.
    // This keeps callback validation and the actual Google grant aligned.
    if (wantsSheetsScopes) {
      scopes.push(...sheetsScopes);
    } else {
      scopes.push("https://www.googleapis.com/auth/calendar");
    }

    googleAuthUrl.searchParams.set("scope", scopes.join(" "));
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("include_granted_scopes", "true");
    if (shouldPromptConsent) {
      googleAuthUrl.searchParams.set("prompt", "consent");
    }
    googleAuthUrl.searchParams.set("state", state);

    if (wantsJson) {
      return attachGoogleOAuthStateCookie(
        NextResponse.json({
          authUrl: googleAuthUrl.toString(),
        }),
        nonce,
      );
    }

    return attachGoogleOAuthStateCookie(
      NextResponse.redirect(googleAuthUrl.toString()),
      nonce,
    );
  } catch (error) {
    console.error("Error initiating Google Calendar connection:", error);
    return NextResponse.json(
      { error: "Failed to initiate calendar connection" },
      { status: 500 },
    );
  }
}
