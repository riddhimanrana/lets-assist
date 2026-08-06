import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getGoogleOAuthConnectionForBinding,
  hasOtherActiveGoogleOAuthConnection,
  hasUnboundActiveGoogleOAuthConnection,
} from "@/lib/auth/google-oauth-connection-store";
import type { GoogleOAuthConnectionBindingExpectation } from "@/lib/auth/google-oauth-connection-binding";
import { authorizeGoogleOAuthOrganizationRequest } from "@/lib/auth/google-oauth-authorization";
import type { GoogleOAuthCsfImportCapability } from "@/lib/auth/google-oauth-state";
import { hasGoogleCalendarWriteScope } from "@/lib/auth/google-oauth-scopes";
import {
  shouldRevokeGoogleOAuthGrant,
  type GoogleOAuthRemoteRevocationState,
} from "@/lib/auth/google-oauth-disconnect";
import { encrypt, decrypt } from "@/lib/encryption";
import { Project } from "@/types";
import {
  GOOGLE_CALENDAR_API,
  GOOGLE_REVOKE_URL,
  GOOGLE_SHEETS_SCOPES,
  PERSONAL_CALENDAR_GOOGLE_BINDING,
  formatProjectToCalendarEvent,
  getCalendarConnection,
  getGoogleCalendarAccessState,
  getOrCreateVolunteeringCalendar,
  getValidAccessToken,
  hasRequiredScopes,
  isTokenExpired,
  refreshAccessToken,
} from "./calendar";

export async function ensureOrganizationCalendar(
  accessToken: string,
  calendarId: string | null | undefined,
  calendarName: string,
): Promise<{ calendarId: string; created: boolean } | null> {
  if (calendarId) {
    const accessState = await getGoogleCalendarAccessState(
      accessToken,
      calendarId,
    );
    if (accessState.status === "accessible") {
      return { calendarId, created: false };
    }

    // Only a positively reconciled 404 proves that replacing the configured
    // calendar is safe. Authorization, rate-limit, provider, timeout, network,
    // malformed, and unknown failures retain the existing calendar identity.
    if (accessState.status !== "missing") {
      console.error("Organization calendar lookup was inconclusive:", {
        status: accessState.status,
        httpStatus:
          "httpStatus" in accessState ? accessState.httpStatus : undefined,
        reason:
          accessState.status === "retryable_error"
            ? accessState.reason
            : undefined,
      });
      return null;
    }
  }

  try {
    const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: calendarName,
        description: `Volunteer events from ${calendarName} on Let's Assist`,
        timeZone: "America/Los_Angeles",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to create organization calendar:", error);
      return null;
    }

    const calendar = await response.json();
    const newCalendarId = calendar.id as string;

    try {
      await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(newCalendarId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            colorId: "3",
          }),
        },
      );
    } catch (error) {
      console.error("Failed to set organization calendar color:", error);
    }

    return { calendarId: newCalendarId, created: true };
  } catch (error) {
    console.error("Error creating organization calendar:", error);
    return null;
  }
}

export async function createGoogleCalendarEventForCalendar(
  accessToken: string,
  calendarId: string,
  project: Project,
  scheduleId?: string,
): Promise<string | null> {
  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData) {
    throw new Error("Invalid project schedule data");
  }

  if (!Array.isArray(eventData)) {
    try {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventData),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Failed to create calendar event:", error);
        throw new Error("Failed to create calendar event");
      }

      const result = await response.json();
      return result.id;
    } catch (error) {
      console.error("Error creating calendar event:", error);
      throw error;
    }
  }

  const eventIds: string[] = [];
  for (const event of eventData) {
    try {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        },
      );

      if (response.ok) {
        const result = await response.json();
        eventIds.push(result.id);
      }
    } catch (error) {
      console.error("Error creating calendar event:", error);
    }
  }

  return eventIds.length > 0 ? eventIds[0] : null;
}

export async function updateGoogleCalendarEventForCalendar(
  accessToken: string,
  calendarId: string,
  eventId: string,
  project: Project,
  scheduleId?: string,
): Promise<boolean> {
  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData || Array.isArray(eventData)) {
    throw new Error("Invalid project schedule data");
  }

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventData),
      },
    );

    return response.ok;
  } catch (error) {
    console.error("Error updating calendar event:", error);
    return false;
  }
}

export async function deleteGoogleCalendarEventForCalendar(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.ok || response.status === 404;
  } catch (error) {
    console.error("Error deleting calendar event:", error);
    return false;
  }
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
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No valid calendar connection found");
  }

  // Get or create dedicated volunteering calendar
  const calendarId = await getOrCreateVolunteeringCalendar(accessToken, userId);
  if (!calendarId) {
    console.error("Failed to get or create volunteering calendar");
    throw new Error("Failed to access volunteering calendar");
  }

  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData) {
    throw new Error("Invalid project schedule data");
  }

  // Handle single event
  if (!Array.isArray(eventData)) {
    try {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
          calendarId,
        )}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventData),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Failed to create calendar event:", error);
        throw new Error("Failed to create calendar event");
      }

      const result = await response.json();
      return result.id;
    } catch (error) {
      console.error("Error creating calendar event:", error);
      throw error;
    }
  }

  // Handle multiple events (shouldn't happen with scheduleId, but just in case)
  const eventIds: string[] = [];
  for (const event of eventData) {
    try {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
          calendarId,
        )}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        },
      );

      if (response.ok) {
        const result = await response.json();
        eventIds.push(result.id);
      }
    } catch (error) {
      console.error("Error creating calendar event:", error);
    }
  }

  return eventIds.length > 0 ? eventIds[0] : null;
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
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No valid calendar connection found");
  }

  // Get or create dedicated volunteering calendar
  const calendarId = await getOrCreateVolunteeringCalendar(accessToken, userId);
  if (!calendarId) {
    console.error("Failed to get or create volunteering calendar");
    throw new Error("Failed to access volunteering calendar");
  }

  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData || Array.isArray(eventData)) {
    throw new Error("Invalid project schedule data");
  }

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventData),
      },
    );

    return response.ok;
  } catch (error) {
    console.error("Error updating calendar event:", error);
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
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No valid calendar connection found");
  }

  // Get or create dedicated volunteering calendar
  const calendarId = await getOrCreateVolunteeringCalendar(accessToken, userId);
  if (!calendarId) {
    console.error("Failed to get or create volunteering calendar");
    throw new Error("Failed to access volunteering calendar");
  }

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.ok || response.status === 404; // 404 means already deleted
  } catch (error) {
    console.error("Error deleting calendar event:", error);
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
    const response = await fetch(
      `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`,
      { method: "POST" },
    );

    return response.ok;
  } catch (error) {
    console.error("Error revoking access:", error);
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
  } = {},
): Promise<{
  success: boolean;
  error?: string;
  remoteRevocation?: GoogleOAuthRemoteRevocationState;
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

  const supabase = options.useServiceRole
    ? getAdminClient()
    : await createClient();

  const hasOtherActiveConnection = await hasOtherActiveGoogleOAuthConnection(
    userId,
    connection.id,
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
      console.error("Failed to revoke Google access:", error);
      remoteRevocation = "failed";
    }
  }

  // Delete rather than retaining an inactive refresh token. The binding row is
  // removed by FK cascade, so reconnect always creates a fresh exact binding.
  const { error: deactivateError } = await supabase
    .from("user_calendar_connections")
    .delete()
    .eq("id", connection.id)
    .eq("user_id", userId)
    .eq("provider", "google");

  if (deactivateError) {
    console.error("Failed to deactivate Google connection:", deactivateError);
    return { success: false, error: "Failed to disconnect Google account" };
  }

  return { success: true, remoteRevocation };
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

  const supabase = await createClient();
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

  const supabase = useServiceRole ? getAdminClient() : await createClient();
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    options.expectedBinding,
    { useServiceRole },
  );
  if (!connection) return null;

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
    return decrypt(connection.access_token);
  }

  const decryptedRefreshToken = decrypt(connection.refresh_token);
  const refreshed = await refreshAccessToken(decryptedRefreshToken);

  if (!refreshed) {
    await supabase
      .from("user_calendar_connections")
      .update({ is_active: false })
      .eq("id", connection.id);
    return null;
  }

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
  if (!currentConnection || currentConnection.id !== connection.id) return null;

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
    .select("id")
    .maybeSingle();

  if (persistError || !persistedConnection) return null;

  return refreshed.accessToken;
}
