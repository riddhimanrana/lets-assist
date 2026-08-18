/**
 * Google OAuth - Handle Callback
 * GET /api/google/oauth/callback
 *
 * One durable attempt is claimed exactly once here. A duplicated or replayed
 * callback never re-exchanges the authorization code: it is told whether the
 * original exchange is still running or has already settled, and is redirected
 * to the same recorded destination with the same recorded outcome.
 */

import { createClient } from "@/lib/supabase/server";
import {
  digestGoogleOAuthSecret,
  digestGoogleOAuthSessionBinding,
  getGoogleOAuthAttemptCookieOptions,
  parseGoogleOAuthState,
} from "@/lib/auth/google-oauth-attempt";
import {
  claimGoogleOAuthAttempt,
  finalizeGoogleOAuthAttempt,
  markGoogleOAuthAttemptExchanged,
} from "@/lib/auth/google-oauth-attempt-store";
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
  DVHS_CSF_GOOGLE_IMPORT_EMAIL,
  isDvhsCsfGoogleImportBinding,
  validateGoogleOAuthCallbackIdentity,
} from "@/lib/auth/google-oauth-csf-identity";
import { canReuseExistingGoogleRefreshToken } from "./connection-selection";
import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";

/**
 * Every redirect this handler emits is built on this origin, so it must
 * never come from the request on a hosted deployment. The previous version
 * fell back to `request.nextUrl.origin` whenever `NEXT_PUBLIC_SITE_URL` was
 * unset or malformed, and `NextRequest#nextUrl` is derived from the
 * `x-forwarded-host`/`Host` headers -- so a misconfigured deployment turned
 * a header into the destination this handler sends an authenticated
 * browser to, carrying the OAuth result in its query string.
 *
 * `resolveAuthRedirectOrigin` is the same selection `/auth/callback` and
 * `/auth/confirm` use: the validated configured origin always, except on a
 * loopback deployment answering the same loopback service and port, where
 * the request's own loopback spelling is kept because that is the cookie
 * origin. A hosted deployment with no usable configured origin raises
 * instead of redirecting anywhere.
 */
function getCallbackBaseUrl(request: NextRequest): string {
  return resolveAuthRedirectOrigin(request.headers.get("host"));
}

/**
 * Clear only this attempt's own cookie. The name is attempt-specific, so a
 * finished callback cannot disturb another tab's in-flight attempt -- the
 * exact failure the shared single-nonce cookie used to cause.
 */
function redirectAndConsumeAttemptCookie(
  destination: string | URL,
  cookieName: string | null,
): NextResponse {
  const response = NextResponse.redirect(destination);
  if (cookieName) {
    response.cookies.set(cookieName, "", {
      ...getGoogleOAuthAttemptCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });
  }
  return response;
}

function buildCallbackRedirect(
  baseUrl: string,
  returnTo: string | null,
  result: {
    error?: string;
    success?: string;
    email?: string;
    correlationId?: string | null;
  },
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
  // A short correlation code, never the state, the attempt id, or a provider
  // message. It is the only thing an operator needs to quote in a report.
  if (result.correlationId) {
    redirectUrl.searchParams.set("code", result.correlationId);
  }

  return redirectUrl;
}

export async function GET(request: NextRequest) {
  const baseUrl = getCallbackBaseUrl(request);
  const parsedState = parseGoogleOAuthState(
    new URL(request.url).searchParams.get("state"),
  );
  const attemptCookieName = parsedState?.cookieName ?? null;

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const providerError = searchParams.get("error");
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    const { data: claims } = await supabase.auth.getClaims();
    const sessionDigest = digestGoogleOAuthSessionBinding(
      claims?.claims?.session_id,
    );

    if (authError || !user || !sessionDigest) {
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, null, { error: "unauthorized" }),
        attemptCookieName,
      );
    }

    if (!parsedState) {
      console.warn("Rejected Google OAuth callback: malformed state");
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, null, { error: "invalid_state" }),
        attemptCookieName,
      );
    }

    const cookieSecret = request.cookies.get(parsedState.cookieName)?.value;
    // The durable ledger, not a cookie comparison in this handler, is the one
    // authority on whether this callback may proceed.
    const claim = await claimGoogleOAuthAttempt({
      stateDigest: parsedState.stateDigest,
      cookieSecretDigest: digestGoogleOAuthSecret(cookieSecret ?? ""),
      userId: user.id,
      sessionDigest,
    });

    if (claim.verdict === "in_progress") {
      // The original exchange is still running. Send the browser back to the
      // surface that started it rather than racing a second token exchange.
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, claim.returnTo, {
          error: "connection_in_progress",
          correlationId: claim.correlationId,
        }),
        null,
      );
    }

    if (claim.verdict === "already_settled") {
      // Replay the recorded outcome. The code is never exchanged twice and no
      // duplicate connection or organization side effect can be created.
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(
          baseUrl,
          claim.returnTo,
          claim.recordedStatus === "succeeded"
            ? { success: "connected" }
            : {
                // An `unknown` record means the code was spent but the outcome
                // was never confirmed; the operator is told to recheck, never
                // shown a false success or a false failure.
                error: claim.recordedOutcomeCode ?? "unknown",
                correlationId: claim.correlationId,
              },
        ),
        attemptCookieName,
      );
    }

    if (claim.verdict === "expired") {
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, claim.returnTo, {
          error: "expired_state",
          correlationId: claim.correlationId,
        }),
        attemptCookieName,
      );
    }

    if (claim.verdict !== "claimed") {
      // unknown_attempt / cookie_mismatch / user_mismatch / session_mismatch.
      // All four are indistinguishable to the browser on purpose.
      console.warn("Rejected Google OAuth callback claim:", claim.verdict);
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, null, {
          error: "invalid_state",
          correlationId: claim.correlationId,
        }),
        attemptCookieName,
      );
    }

    const { attemptId, claimEpoch, binding: attemptBinding, returnTo } = claim;

    /**
     * Settle the attempt, then send the browser to its recorded destination.
     *
     * `finalize` applies only while this worker still holds the claim it was
     * granted. A false return means the processing lease lapsed and another
     * callback took the attempt over, so this worker's result is no longer
     * authoritative -- reporting it could contradict the recorded outcome.
     * The operator is asked to recheck instead, with the correlation code.
     */
    const settle = async (
      outcome:
        | { error: string }
        | { success: "connected"; connectionId: string; email?: string },
    ) => {
      const failed = "error" in outcome;
      const settled = await finalizeGoogleOAuthAttempt({
        attemptId,
        claimEpoch,
        status: failed ? "failed" : "succeeded",
        outcomeCode: failed ? outcome.error : "connected",
        connectionId: failed ? null : outcome.connectionId,
      });

      if (!settled) {
        console.warn("Google OAuth attempt was settled by another callback", {
          correlationId: claim.correlationId,
        });
        return redirectAndConsumeAttemptCookie(
          buildCallbackRedirect(baseUrl, returnTo, {
            error: "connection_in_progress",
            correlationId: claim.correlationId,
          }),
          attemptCookieName,
        );
      }

      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(
          baseUrl,
          returnTo,
          failed
            ? { error: outcome.error, correlationId: claim.correlationId }
            : {
                success: "connected",
                ...(outcome.email ? { email: outcome.email } : {}),
              },
        ),
        attemptCookieName,
      );
    };

    // Handle user denial
    if (providerError) {
      // Provider denial detail is recorded as a bounded code only.
      return settle({ error: "access_denied" });
    }

    if (!code) {
      return settle({ error: "invalid_request" });
    }

    const userId = user.id;
    const authorizationInput = {
      organizationId: attemptBinding.organizationId,
      pluginKey: attemptBinding.pluginKey,
      purpose: attemptBinding.purpose,
      requestedCapability: attemptBinding.requestedCapability,
      userId,
      userEmail: user.email,
    };
    const authorization =
      await authorizeGoogleOAuthOrganizationRequest(authorizationInput);
    if (!authorization.allowed) {
      return settle({
        error: googleOAuthAuthorizationError(
          authorization,
          attemptBinding.purpose,
        ),
      });
    }

    const binding = {
      purpose: attemptBinding.purpose,
      organizationId: attemptBinding.organizationId,
      pluginKey: attemptBinding.pluginKey,
    };
    // Resolve only through the server-managed signed binding while the initial
    // authorization is fresh. Inactive exact matches may be reactivated;
    // legacy and cross-purpose rows fail closed.
    const existingConnection = await getGoogleOAuthConnectionForBinding(
      userId,
      binding,
      { activeOnly: false, useServiceRole: true },
    );

    // An authorization code is single use. Record the attempt as spent before
    // presenting it, so a callback that arrives after this handler dies
    // reconciles to an explicit unknown outcome instead of re-exchanging.
    const exchangeMarked = await markGoogleOAuthAttemptExchanged({
      attemptId,
      claimEpoch,
    });
    if (!exchangeMarked) {
      console.warn("Google OAuth attempt exchange marker was not committed", {
        correlationId: claim.correlationId,
      });
      return redirectAndConsumeAttemptCookie(
        buildCallbackRedirect(baseUrl, returnTo, {
          error: "connection_in_progress",
          correlationId: claim.correlationId,
        }),
        attemptCookieName,
      );
    }

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
        // PKCE: the verifier was released by the ledger to this claim only.
        code_verifier: claim.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      // Provider response bodies may include grant diagnostics. Keep callback
      // logs limited to non-sensitive transport metadata.
      console.error("Google token exchange failed", {
        status: tokenResponse.status,
        correlationId: claim.correlationId,
      });
      return settle({ error: "token_exchange_failed" });
    }

    const tokens = await tokenResponse.json();
    const grantedScopes =
      typeof tokens.scope === "string" ? tokens.scope : null;
    // Determine connection type based on granted scopes
    const hasSheetsScopes = hasGoogleDriveFileScope(grantedScopes);
    const hasCalendarScopes = hasGoogleCalendarWriteScope(grantedScopes);
    const requiresSheetsScopes =
      attemptBinding.purpose === "personal_sheets" ||
      attemptBinding.purpose === "organization_sheets" ||
      attemptBinding.purpose === "csf_import";
    const requiresCalendarScopes =
      attemptBinding.purpose === "personal_calendar" ||
      attemptBinding.purpose === "organization_calendar";
    // Google may return a partial grant. The capability this attempt was
    // issued for decides which scope family is mandatory; one family never
    // silently satisfies the other.
    if (
      (requiresSheetsScopes && !hasSheetsScopes) ||
      (requiresCalendarScopes && !hasCalendarScopes)
    ) {
      return settle({ error: "missing_required_scope" });
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
      return settle({ error: "failed_to_get_email" });
    }

    const userInfo = await userInfoResponse.json();
    const calendarEmail =
      typeof userInfo.email === "string" && userInfo.email.trim()
        ? userInfo.email.trim()
        : null;
    if (!calendarEmail) {
      return settle({ error: "failed_to_get_email" });
    }

    const identityDecision = validateGoogleOAuthCallbackIdentity({
      binding,
      email: calendarEmail,
      emailVerified: userInfo.verified_email === true,
    });
    if (!identityDecision.ok) {
      return settle({ error: identityDecision.error });
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
      return settle({ error: "no_refresh_token" });
    }

    // Google calls may take long enough for organization membership, plugin
    // availability, or a CSF capability grant to change. Revalidate the signed
    // intent immediately before persistence so a revoked actor cannot create or
    // reactivate a credential using an authorization decision made earlier.
    const finalAuthorization =
      await authorizeGoogleOAuthOrganizationRequest(authorizationInput);
    if (!finalAuthorization.allowed) {
      return settle({
        error: googleOAuthAuthorizationError(
          finalAuthorization,
          attemptBinding.purpose,
        ),
      });
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
      requestedCapability: attemptBinding.requestedCapability,
      identityEmail: isDvhsCsfGoogleImportBinding(binding)
        ? DVHS_CSF_GOOGLE_IMPORT_EMAIL
        : null,
      identityVerifiedAt: isDvhsCsfGoogleImportBinding(binding)
        ? new Date().toISOString()
        : null,
    });
    if (!saveResult.connectionId) {
      return settle({ error: "connection_failed" });
    }

    if (attemptBinding.organizationId) {
      const serviceSupabase = getAdminClient();

      // Handle organization calendar sync (separate from sheets sync)
      if (attemptBinding.purpose === "organization_calendar") {
        const { data: org } = await serviceSupabase
          .from("organizations")
          .select("name")
          .eq("id", attemptBinding.organizationId)
          .maybeSingle();

        const { data: existingSync } = await serviceSupabase
          .from("organization_calendar_syncs")
          .select("calendar_id, auto_sync, last_synced_at")
          .eq("organization_id", attemptBinding.organizationId)
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
          return settle({ error: "org_calendar_failed" });
        }

        await serviceSupabase.from("organization_calendar_syncs").upsert(
          {
            organization_id: attemptBinding.organizationId,
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
      if (attemptBinding.purpose === "organization_sheets") {
        const { data: existingSync, error: existingSyncError } =
          await serviceSupabase
            .from("organization_sheet_syncs")
            .select("id")
            .eq("organization_id", attemptBinding.organizationId)
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
            .eq("organization_id", attemptBinding.organizationId);

          if (ownerUpdateError) {
            console.error(
              "Failed to update organization sheet sync owner during OAuth callback:",
              ownerUpdateError,
            );
          }
        }
      }
    }

    return settle({
      success: "connected",
      connectionId: saveResult.connectionId,
      ...(isDvhsCsfGoogleImportBinding(binding)
        ? {}
        : { email: calendarEmail }),
    });
  } catch (error) {
    console.error("Error in Google Calendar callback:", error);
    return redirectAndConsumeAttemptCookie(
      buildCallbackRedirect(baseUrl, null, { error: "unknown" }),
      attemptCookieName,
    );
  }
}
