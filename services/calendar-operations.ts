import { safeConsole } from "@/lib/safe-console";
import { getGoogleOAuthCredentialClient } from "@/lib/auth/google-oauth-credential-client";
import {
  getGoogleOAuthConnectionForBinding,
  hasOtherActiveGoogleOAuthConnection,
  hasUnboundActiveGoogleOAuthConnection,
} from "@/lib/auth/google-oauth-connection-store";
import type { GoogleOAuthConnectionBindingExpectation } from "@/lib/auth/google-oauth-connection-binding";
import { googleOAuthConnectionHasVerifiedCsfIdentity } from "@/lib/auth/google-oauth-csf-identity";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import type { GoogleOAuthCsfImportCapability } from "@/lib/auth/google-oauth-state";
import { hasGoogleCalendarWriteScope } from "@/lib/auth/google-oauth-scopes";
import {
  shouldRevokeGoogleOAuthGrant,
  type GoogleOAuthRemoteRevocationState,
} from "@/lib/auth/google-oauth-disconnect";
import { decrypt, decryptWithRotation, encrypt } from "@/lib/encryption";
import { Project } from "@/types";
import {
  GOOGLE_EVENT_ID_PATTERN,
  googleCalendarEventUrl,
} from "@/lib/google-calendar-identifiers";
import {
  GOOGLE_REVOKE_URL,
  GOOGLE_SHEETS_SCOPES,
  PERSONAL_CALENDAR_GOOGLE_BINDING,
  formatProjectToCalendarEvent,
  getCalendarConnection,
  getValidAccessToken,
  hasRequiredScopes,
  isTokenExpired,
  requestGoogleAccessTokenRefresh,
} from "./calendar";

export async function ensureOrganizationCalendar(
  accessToken: string,
  _calendarId: string | null | undefined,
  calendarName: string,
  context?: { organizationId: string; userId: string },
): Promise<{ calendarId: string; created: boolean } | null> {
  // The optional context keeps the public signature compatible, but a caller
  // must provide its server-derived actor and organization before any write.
  if (!context) return null;
  const { ensureDurableOrganizationCalendar } =
    await import("./organization-calendar/destination");
  return ensureDurableOrganizationCalendar({
    accessToken,
    organizationId: context.organizationId,
    userId: context.userId,
    calendarName,
  });
}

/**
 * Create a calendar event in user's Google Calendar
 * Uses dedicated "Let's Assist Volunteering" calendar (creates if needed)
 */
export async function createGoogleCalendarEvent(
  userId: string,
  project: Project,
  scheduleId?: string,
): Promise<string | null> {
  const { synchronizePersonalCalendar } = await import("./personal-calendar");
  const result = await synchronizePersonalCalendar({
    userId,
    sourceKind: "project",
    sourceId: project.id,
    operation: "sync",
    project,
    scheduleId,
  });
  return result.eventId;
}

/**
 * Update an existing calendar event
 * Uses dedicated "Let's Assist Volunteering" calendar
 */
export async function updateGoogleCalendarEvent(
  userId: string,
  eventId: string,
  project: Project,
  scheduleId?: string,
): Promise<boolean> {
  if (!GOOGLE_EVENT_ID_PATTERN.test(eventId)) return false;
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No valid calendar connection found");
  }

  // Mutating an existing event must never create a replacement calendar.
  const connection = await getCalendarConnection(userId);
  const calendarId = connection?.preferences?.volunteering_calendar_id;
  if (!calendarId) {
    safeConsole.error("No stored volunteering calendar is available");
    throw new Error("Failed to access volunteering calendar");
  }

  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData || Array.isArray(eventData)) {
    throw new Error("Invalid project schedule data");
  }

  try {
    const response = await fetch(googleCalendarEventUrl(calendarId, eventId), {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventData),
    });

    return response.ok;
  } catch (error) {
    safeConsole.error("Error updating calendar event:", error);
    return false;
  }
}

/**
 * Delete a calendar event
 * Uses dedicated "Let's Assist Volunteering" calendar
 */
export async function deleteGoogleCalendarEvent(
  userId: string,
  eventId: string,
): Promise<boolean> {
  if (!GOOGLE_EVENT_ID_PATTERN.test(eventId)) return false;
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No valid calendar connection found");
  }

  // Mutating an existing event must never create a replacement calendar.
  const connection = await getCalendarConnection(userId);
  const calendarId = connection?.preferences?.volunteering_calendar_id;
  if (!calendarId) {
    safeConsole.error("No stored volunteering calendar is available");
    throw new Error("Failed to access volunteering calendar");
  }

  try {
    const response = await fetch(googleCalendarEventUrl(calendarId, eventId), {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.ok || response.status === 404; // 404 means already deleted
  } catch (error) {
    safeConsole.error("Error deleting calendar event:", error);
    return false;
  }
}

/**
 * Revoke Google Calendar access
 */
export async function revokeGoogleCalendarAccess(
  refreshToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });

    return response.ok;
  } catch {
    safeConsole.error("Error revoking access:");
    return false;
  }
}

/**
 * Delete the user's exact Google purpose credential and optionally revoke it with Google.
 */
export async function deactivateGoogleConnection(
  userId: string,
  options: {
    revokeAccess?: boolean;
    expectedBinding?: GoogleOAuthConnectionBindingExpectation;
    useServiceRole?: boolean;
    expectedConnection?: { id: string; updatedAt: string };
  } = {},
): Promise<{
  success: boolean;
  error?: string;
  remoteRevocation?: GoogleOAuthRemoteRevocationState;
  localCleanup?: "removed" | "failed";
}> {
  const expectedBinding =
    options.expectedBinding ?? PERSONAL_CALENDAR_GOOGLE_BINDING;
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    expectedBinding,
    { activeOnly: false, useServiceRole: options.useServiceRole },
  );
  if (!connection) {
    return { success: false, error: "No active Google connection found" };
  }
  if (
    options.expectedConnection &&
    (connection.id !== options.expectedConnection.id ||
      connection.updated_at !== options.expectedConnection.updatedAt)
  ) {
    return {
      success: false,
      error: "Google connection changed. Refresh the page and try again.",
      remoteRevocation: "not_requested",
      localCleanup: "failed",
    };
  }

  const supabase = await getGoogleOAuthCredentialClient(
    userId,
    options.useServiceRole,
  );
  if (!supabase)
    return { success: false, error: "Google connection access is unavailable" };

  const hasOtherActiveConnection = await hasOtherActiveGoogleOAuthConnection(
    userId,
    connection.id,
    { useServiceRole: options.useServiceRole },
  );
  const shouldRevoke = shouldRevokeGoogleOAuthGrant({
    requested: options.revokeAccess !== false,
    hasOtherActiveConnection,
  });
  let remoteRevocation: GoogleOAuthRemoteRevocationState =
    options.revokeAccess === false
      ? "not_requested"
      : hasOtherActiveConnection
        ? "skipped_shared_grant"
        : "failed";

  if (shouldRevoke && connection.refresh_token) {
    try {
      const decryptedRefreshToken = decrypt(connection.refresh_token);
      remoteRevocation = (await revokeGoogleCalendarAccess(
        decryptedRefreshToken,
      ))
        ? "revoked"
        : "failed";
    } catch (error) {
      safeConsole.error("Failed to revoke Google access:", error);
      remoteRevocation = "failed";
    }
  }

  // Recheck after provider I/O so a changed session or reconnect keeps its row.
  const currentConnection = await getGoogleOAuthConnectionForBinding(
    userId,
    expectedBinding,
    { activeOnly: false, useServiceRole: options.useServiceRole },
  );
  if (
    !currentConnection ||
    currentConnection.id !== connection.id ||
    currentConnection.updated_at !== connection.updated_at ||
    currentConnection.access_token !== connection.access_token ||
    currentConnection.refresh_token !== connection.refresh_token ||
    currentConnection.token_expires_at !== connection.token_expires_at
  ) {
    return {
      success: false,
      error: "Google connection changed. Refresh the page and try again.",
      remoteRevocation,
      localCleanup: "failed",
    };
  }

  // Remove only this unchanged credential. Its binding is removed by FK cascade.
  const { data: deletedConnection, error: deactivateError } = await supabase
    .from("user_calendar_connections")
    .delete()
    .eq("id", connection.id)
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", connection.is_active)
    .eq("access_token", connection.access_token)
    .eq("refresh_token", connection.refresh_token)
    .eq("token_expires_at", connection.token_expires_at)
    .eq("updated_at", connection.updated_at)
    .select("id")
    .maybeSingle();

  if (deactivateError || !deletedConnection) {
    safeConsole.error(
      "Failed to deactivate Google connection:",
      deactivateError,
    );
    return {
      success: false,
      error: "Failed to disconnect Google account",
      remoteRevocation,
      localCleanup: "failed",
    };
  }

  return { success: true, remoteRevocation, localCleanup: "removed" };
}

export async function hasLegacyGoogleOAuthReconnectRequired(userId: string) {
  return hasUnboundActiveGoogleOAuthConnection(userId);
}

/**
 * Get user's calendar email
 */
export async function getCalendarEmail(userId: string): Promise<string | null> {
  const connection = await getCalendarConnection(userId);
  return connection?.calendar_email || null;
}

/**
 * Check if user has an active calendar connection
 */
export async function hasActiveCalendarConnection(
  userId: string,
): Promise<boolean> {
  const connection = await getCalendarConnection(userId);
  return connection !== null && connection.is_active;
}

export async function markPersonalCalendarConnectionSynced(
  userId: string,
): Promise<void> {
  const connection = await getCalendarConnection(userId);
  if (!connection) return;

  const supabase = await getGoogleOAuthCredentialClient(userId);
  if (!supabase) return;
  await supabase
    .from("user_calendar_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connection.id)
    .eq("user_id", userId);
}

/**
 * Get a valid Google access token for external integrations (e.g., Sheets)
 */
export async function getGoogleAccessToken(
  userId: string,
): Promise<string | null> {
  return getGoogleAccessTokenForUser(userId, false, {
    connectionType: "calendar",
    expectedBinding: PERSONAL_CALENDAR_GOOGLE_BINDING,
  });
}

/**
 * Get a valid Google access token for Sheets integration.
 */
export async function getGoogleAccessTokenForSheets(
  userId: string,
  expectedBinding: GoogleOAuthConnectionBindingExpectation,
  requestedCapability?: GoogleOAuthCsfImportCapability,
): Promise<string | null> {
  return getGoogleAccessTokenForUser(userId, false, {
    requiredScopes: [...GOOGLE_SHEETS_SCOPES],
    connectionType: "sheets",
    expectedBinding,
    requestedCapability,
  });
}

/**
 * Get a valid Google access token for Sheets integration with optional service role.
 */
export async function getGoogleAccessTokenForSheetsForUser(
  userId: string,
  useServiceRole: boolean,
  expectedBinding: GoogleOAuthConnectionBindingExpectation,
  requestedCapability?: GoogleOAuthCsfImportCapability,
): Promise<string | null> {
  return getGoogleAccessTokenForUser(userId, useServiceRole, {
    requiredScopes: [...GOOGLE_SHEETS_SCOPES],
    connectionType: "sheets",
    expectedBinding,
    requestedCapability,
  });
}

/**
 * Get a Google access token with optional service-role lookup
 * Used for background jobs where no user session exists.
 */
export async function getGoogleAccessTokenForUser(
  userId: string,
  useServiceRole: boolean,
  options: {
    requiredScopes?: string[];
    connectionType?: "calendar" | "sheets" | "both";
    expectedBinding: GoogleOAuthConnectionBindingExpectation;
    requestedCapability?: GoogleOAuthCsfImportCapability;
  },
): Promise<string | null> {
  const supabase = await getGoogleOAuthCredentialClient(userId, useServiceRole);
  if (!supabase) return null;
  if (options.expectedBinding.organizationId) {
    if (
      options.expectedBinding.purpose === "csf_import" &&
      !options.requestedCapability
    ) {
      return null;
    }

    const authorization = await authorizeGoogleOAuthOrganizationRequest({
      userId,
      organizationId: options.expectedBinding.organizationId,
      pluginKey: options.expectedBinding.pluginKey as "dvhs-csf" | null,
      purpose: options.expectedBinding.purpose,
      requestedCapability: options.requestedCapability ?? null,
    });
    if (!authorization.allowed) return null;
  }

  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    options.expectedBinding,
    { useServiceRole },
  );
  if (!connection) return null;
  if (
    !googleOAuthConnectionHasVerifiedCsfIdentity(options.expectedBinding, {
      connectionEmail: connection.calendar_email,
      identityEmail: connection.binding_identity_email,
      identityVerifiedAt: connection.binding_identity_verified_at,
    })
  ) {
    return null;
  }

  const requiredScopes = options?.requiredScopes?.filter(Boolean) ?? [];
  const allowedTypes =
    options.connectionType === "calendar"
      ? ["calendar", "both"]
      : options.connectionType === "sheets"
        ? ["sheets", "both"]
        : options.connectionType === "both"
          ? ["both"]
          : ["calendar", "sheets", "both"];
  if (
    !allowedTypes.includes(connection.connection_type ?? "") ||
    !hasRequiredScopes(connection.granted_scopes, requiredScopes) ||
    (options.connectionType === "calendar" &&
      !hasGoogleCalendarWriteScope(connection.granted_scopes))
  ) {
    return null;
  }

  if (!isTokenExpired(connection.token_expires_at)) {
    const decrypted = decryptWithRotation(connection.access_token);
    if (decrypted.reencrypted) {
      const { error } = await supabase
        .from("user_calendar_connections")
        .update({ access_token: decrypted.reencrypted })
        .eq("id", connection.id)
        .eq("user_id", userId)
        .eq("provider", "google")
        .eq("access_token", connection.access_token);
      if (error) safeConsole.error("Failed to rotate Google access credential");
    }
    return decrypted.plaintext;
  }

  const decryptedRefresh = decryptWithRotation(connection.refresh_token);
  if (decryptedRefresh.reencrypted) {
    const { error } = await supabase
      .from("user_calendar_connections")
      .update({ refresh_token: decryptedRefresh.reencrypted })
      .eq("id", connection.id)
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("refresh_token", connection.refresh_token);
    if (error) safeConsole.error("Failed to rotate Google refresh credential");
  }
  const refreshed = await requestGoogleAccessTokenRefresh(
    decryptedRefresh.plaintext,
  );
  if (refreshed.status === "unavailable") return null;

  // Refresh is an external network boundary. Membership, plugin access, or a
  // CSF capability can be revoked while Google is responding, so repeat the
  // authorization immediately before any refreshed credential is persisted or
  // returned to the caller.
  if (options.expectedBinding.organizationId) {
    const refreshedAuthorization =
      await authorizeGoogleOAuthOrganizationRequest({
        userId,
        organizationId: options.expectedBinding.organizationId,
        pluginKey: options.expectedBinding.pluginKey as "dvhs-csf" | null,
        purpose: options.expectedBinding.purpose,
        requestedCapability: options.requestedCapability ?? null,
      });
    if (!refreshedAuthorization.allowed) return null;
  }

  // A concurrent disconnect must also win over the slow refresh.
  const currentConnection = await getGoogleOAuthConnectionForBinding(
    userId,
    options.expectedBinding,
    { useServiceRole },
  );
  if (
    !currentConnection ||
    currentConnection.id !== connection.id ||
    currentConnection.access_token !== connection.access_token ||
    currentConnection.refresh_token !==
      (decryptedRefresh.reencrypted ?? connection.refresh_token) ||
    currentConnection.token_expires_at !== connection.token_expires_at ||
    !googleOAuthConnectionHasVerifiedCsfIdentity(options.expectedBinding, {
      connectionEmail: currentConnection.calendar_email,
      identityEmail: currentConnection.binding_identity_email,
      identityVerifiedAt: currentConnection.binding_identity_verified_at,
    })
  ) {
    return null;
  }

  if (refreshed.status === "invalid_grant") {
    // A reconnect or another successful refresh must win over this stale failure.
    await supabase
      .from("user_calendar_connections")
      .update({ is_active: false })
      .eq("id", connection.id)
      .eq("user_id", userId)
      .eq("provider", "google")
      .eq("is_active", true)
      .eq("access_token", connection.access_token)
      .eq(
        "refresh_token",
        decryptedRefresh.reencrypted ?? connection.refresh_token,
      )
      .eq("token_expires_at", connection.token_expires_at);
    return null;
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  const encryptedAccessToken = encrypt(refreshed.accessToken);

  const { data: persistedConnection, error: persistError } = await supabase
    .from("user_calendar_connections")
    .update({
      access_token: encryptedAccessToken,
      token_expires_at: newExpiresAt.toISOString(),
    })
    .eq("id", connection.id)
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", true)
    .eq("access_token", connection.access_token)
    .eq(
      "refresh_token",
      decryptedRefresh.reencrypted ?? connection.refresh_token,
    )
    .eq("token_expires_at", connection.token_expires_at)
    .select("id")
    .maybeSingle();

  if (persistError || !persistedConnection) return null;

  return refreshed.accessToken;
}
