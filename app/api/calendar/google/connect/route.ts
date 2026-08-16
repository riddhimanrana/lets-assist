/**
 * Google OAuth - Initiate Connection
 * GET /api/calendar/google/connect
 *
 * Every Calendar, Drive/Sheets, and DVHS-CSF import connection starts here.
 * The request is recorded as one durable server-side attempt before the
 * browser is sent to Google, so concurrent attempts from different tabs or
 * surfaces no longer overwrite one another.
 */

import { createClient } from "@/lib/supabase/server";
import {
  createGoogleOAuthAttemptSecrets,
  digestGoogleOAuthSessionBinding,
  getGoogleOAuthAttemptCookieOptions,
} from "@/lib/auth/google-oauth-attempt";
import { beginGoogleOAuthAttempt } from "@/lib/auth/google-oauth-attempt-store";
import {
  getGoogleOAuthDefaultReturnRoute,
  resolveGoogleOAuthReturnRoute,
} from "@/lib/auth/google-oauth-return-routes";
import {
  authorizeGoogleOAuthOrganizationRequest,
  getGoogleOAuthRequiredScopeFamily,
  googleOAuthAuthorizationError,
  resolveGoogleOAuthRequestIntent,
} from "@/lib/auth/google-oauth-authorization";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import {
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  hasGoogleCalendarWriteScope,
  hasGoogleDriveFileScope,
} from "@/lib/auth/google-oauth-scopes";
import { getAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";

/**
 * The return-route allowlist accepts an organization by id or by slug, because
 * every organization surface links by slug while the connect request carries
 * the id. Resolving both keeps the allowlist strict without forcing call sites
 * to change how they build their own URLs.
 */
async function resolveOrganizationSegments(
  organizationId: string | null,
): Promise<string[]> {
  if (!organizationId) return [];
  try {
    const { data } = await getAdminClient()
      .from("organizations")
      .select("username")
      .eq("id", organizationId)
      .maybeSingle();
    return [organizationId, data?.username].filter(
      (segment): segment is string => Boolean(segment),
    );
  } catch {
    // Degrade to the id-only allowlist rather than failing the request. The
    // slug is a convenience for matching links the UI already builds; losing
    // it narrows the allowlist, which is the safe direction.
    return [organizationId];
  }
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
    // Resolve the allowlisted destination once, before the authorization
    // decision, so a denial lands on the same audited surface a success would
    // and never on an arbitrary same-origin path the caller supplied.
    const organizationSegments = await resolveOrganizationSegments(
      intent.organizationId,
    );
    const { returnTo: allowlistedReturnTo } = resolveGoogleOAuthReturnRoute({
      purpose: intent.purpose,
      returnTo,
      organizationSegments,
    });

    const authorization = await authorizeGoogleOAuthOrganizationRequest({
      ...intent,
      userId: user.id,
      userEmail: user.email,
    });

    if (!authorization.allowed) {
      const baseUrl = resolveAuthRedirectOrigin(request.headers.get("host"));
      const redirectUrl = new URL(allowlistedReturnTo, baseUrl);
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

    // Bind the attempt to the signed-in session, not just the user, so a
    // callback presented after a re-authentication fails closed.
    const { data: claims } = await supabase.auth.getClaims();
    const sessionDigest = digestGoogleOAuthSessionBinding(
      claims?.claims?.session_id,
    );
    if (!sessionDigest) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        ? ["sheets", "both"].includes(
            existingConnection.connection_type ?? "",
          ) && hasGoogleDriveFileScope(existingConnection.granted_scopes)
        : ["calendar", "both"].includes(
            existingConnection.connection_type ?? "",
          ) && hasGoogleCalendarWriteScope(existingConnection.granted_scopes)
      : false;

    const shouldPromptConsent =
      forceConsent ||
      !existingTypeMatches ||
      !existingConnection?.refresh_token;
    const shouldSelectAccount =
      intent.purpose === "csf_import" && intent.pluginKey === "dvhs-csf";

    const sheetsScopes = [GOOGLE_DRIVE_FILE_SCOPE];

    // One durable attempt per connect click. The state Google echoes back and
    // the cookie are both unguessable secrets whose digests live in the ledger,
    // and the PKCE verifier never leaves the server.
    const secrets = createGoogleOAuthAttemptSecrets();
    const recorded = await beginGoogleOAuthAttempt({
      secrets,
      userId: user.id,
      sessionDigest,
      binding: {
        purpose: intent.purpose,
        organizationId: intent.organizationId,
        pluginKey: intent.pluginKey,
        requestedCapability: intent.requestedCapability,
      },
      returnTo: allowlistedReturnTo,
    });

    if (!recorded) {
      // Without a durable record the callback could not be claimed, verified,
      // or made idempotent. Failing here is strictly safer than sending the
      // browser to Google with an unrecorded state.
      const baseUrl = resolveAuthRedirectOrigin(request.headers.get("host"));
      const redirectUrl = new URL(
        getGoogleOAuthDefaultReturnRoute({
          purpose: intent.purpose,
          organizationSegment: organizationSegments[0] ?? null,
        }),
        baseUrl,
      );
      redirectUrl.searchParams.set("error", "attempt_not_started");
      redirectUrl.searchParams.set("code", secrets.correlationId);
      return NextResponse.redirect(redirectUrl.toString());
    }

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
      scopes.push(GOOGLE_CALENDAR_APP_CREATED_SCOPE);
    }

    googleAuthUrl.searchParams.set("scope", scopes.join(" "));
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("include_granted_scopes", "true");
    if (shouldPromptConsent || shouldSelectAccount) {
      const prompts = [
        ...(shouldSelectAccount ? ["select_account"] : []),
        ...(shouldPromptConsent ? ["consent"] : []),
      ];
      googleAuthUrl.searchParams.set("prompt", prompts.join(" "));
    }
    googleAuthUrl.searchParams.set("state", secrets.state);
    // PKCE S256. Only the challenge travels here; the verifier is released
    // from the ledger once, to the single callback that claims this attempt.
    googleAuthUrl.searchParams.set("code_challenge", secrets.codeChallenge);
    googleAuthUrl.searchParams.set("code_challenge_method", "S256");

    const response = wantsJson
      ? NextResponse.json({ authUrl: googleAuthUrl.toString() })
      : NextResponse.redirect(googleAuthUrl.toString());
    response.cookies.set(
      secrets.cookieName,
      secrets.cookieSecret,
      getGoogleOAuthAttemptCookieOptions(),
    );
    return response;
  } catch (error) {
    console.error("Error initiating Google Calendar connection:", error);
    return NextResponse.json(
      { error: "Failed to initiate calendar connection" },
      { status: 500 },
    );
  }
}
