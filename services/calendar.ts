/**
 * Google Calendar API integration service
 * Handles OAuth token management and calendar event operations
 */

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
import {
  Project,
  CalendarConnection,
} from "@/types";
import {
  classifyGoogleCalendarLookupError,
  classifyGoogleCalendarLookupResponse,
  type GoogleCalendarAccessState,
} from "@/services/google-calendar-access-state";

// Google Calendar API endpoints
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS = 10_000;

export const GOOGLE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const PERSONAL_CALENDAR_GOOGLE_BINDING = {
  purpose: "personal_calendar",
  organizationId: null,
  pluginKey: null,
} as const satisfies GoogleOAuthConnectionBindingExpectation;

export function organizationCalendarGoogleBinding(
  organizationId: string,
): GoogleOAuthConnectionBindingExpectation {
  return {
    purpose: "organization_calendar",
    organizationId,
    pluginKey: null,
  };
}

export function organizationSheetsGoogleBinding(
  organizationId: string,
): GoogleOAuthConnectionBindingExpectation {
  return {
    purpose: "organization_sheets",
    organizationId,
    pluginKey: null,
  };
}

type ScopeInput = string | string[] | null | undefined;

const normalizeGoogleScopes = (scopes: ScopeInput): string[] => {
  if (!scopes) return [];
  if (Array.isArray(scopes)) {
    return scopes.map((scope) => scope.trim()).filter(Boolean);
  }
  return scopes
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
};

const hasRequiredScopes = (
  grantedScopes: ScopeInput,
  requiredScopes: string[]
): boolean => {
  if (!requiredScopes.length) return true;
  const granted = new Set(normalizeGoogleScopes(grantedScopes));
  return requiredScopes.every((scope) => granted.has(scope));
};

export const hasGoogleSheetsScopes = (grantedScopes: ScopeInput): boolean =>
  hasRequiredScopes(grantedScopes, [...GOOGLE_SHEETS_SCOPES]);

interface GoogleCalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: "email" | "popup";
      minutes: number;
    }>;
  };
  source?: {
    title: string;
    url: string;
  };
}

/**
 * Get user's active calendar connection (for calendar sync)
 */
export async function getCalendarConnection(
  userId: string
): Promise<CalendarConnection | null> {
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    PERSONAL_CALENDAR_GOOGLE_BINDING,
  );
  if (
    !connection ||
    !["calendar", "both"].includes(connection.connection_type ?? "") ||
    !hasGoogleCalendarWriteScope(connection.granted_scopes)
  ) {
    return null;
  }
  return connection;
}

/**
 * Get user's active sheets connection (for sheets sync)
 */
export async function getSheetsConnection(
  userId: string,
  expectedBinding: GoogleOAuthConnectionBindingExpectation,
  useServiceRole = false,
): Promise<CalendarConnection | null> {
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    expectedBinding,
    { useServiceRole },
  );
  if (
    !connection ||
    !["sheets", "both"].includes(connection.connection_type ?? "")
  ) {
    return null;
  }
  return connection;
}

/**
 * Check if access token is expired or about to expire (within 5 minutes)
 */
function isTokenExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  return expiryTime - now < fiveMinutes;
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      // OAuth error bodies can include provider diagnostics tied to the grant.
      // Record only non-sensitive transport metadata.
      console.error("Failed to refresh Google access token", {
        status: response.status,
      });
      return null;
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidAccessToken(
  userId: string
): Promise<string | null> {
  const supabase = await createClient();
  const connection = await getCalendarConnection(userId);

  if (!connection) {
    return null;
  }

  // Check if token is expired
  if (!isTokenExpired(connection.token_expires_at)) {
    // Token is still valid, decrypt and return
    return decrypt(connection.access_token);
  }

  // Token is expired or about to expire, refresh it
  const decryptedRefreshToken = decrypt(connection.refresh_token);
  const refreshed = await refreshAccessToken(decryptedRefreshToken);

  if (!refreshed) {
    // Failed to refresh, mark connection as inactive
    await supabase
      .from("user_calendar_connections")
      .update({ is_active: false })
      .eq("id", connection.id);
    return null;
  }

  // Update the connection with new access token
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  const encryptedAccessToken = encrypt(refreshed.accessToken);

  await supabase
    .from("user_calendar_connections")
    .update({
      access_token: encryptedAccessToken,
      token_expires_at: newExpiresAt.toISOString(),
    })
    .eq("id", connection.id);

  return refreshed.accessToken;
}

/**
 * Parse date and time into ISO 8601 format for a specific timezone
 * Creates a properly formatted datetime for Google Calendar API
 */
function parseDateTime(dateStr: string, timeStr: string, _timezone: string): string {
  // Create date string in format that will be interpreted as the specified timezone
  // e.g., "2025-10-04T14:30:00" 
  const dateTimeStr = `${dateStr}T${timeStr}:00`;
  
  // Return the ISO string which Google Calendar API expects
  // Google Calendar will interpret this as the timezone specified in the event
  return dateTimeStr;
}

/**
 * Format project data into Google Calendar event format
 */
function formatProjectToCalendarEvent(
  project: Project,
  scheduleId?: string
): GoogleCalendarEvent | GoogleCalendarEvent[] | null {
  const projectTimezone = project.project_timezone || 'America/Los_Angeles';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";
  const projectUrl = `${siteUrl}/projects/${project.id}`;

  const baseEvent = {
    summary: project.title,
    description: project.description,
    location: project.location,
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup" as const, minutes: 15 }],
    },
    source: {
      title: "Let's Assist",
      url: projectUrl,
    },
  };

  // Handle different event types
  if (project.event_type === "oneTime" && project.schedule.oneTime) {
    const schedule = project.schedule.oneTime;
    return {
      ...baseEvent,
      start: {
        dateTime: parseDateTime(schedule.date, schedule.startTime, projectTimezone),
        timeZone: projectTimezone,
      },
      end: {
        dateTime: parseDateTime(schedule.date, schedule.endTime, projectTimezone),
        timeZone: projectTimezone,
      },
    };
  }

  if (project.event_type === "multiDay" && project.schedule.multiDay) {
    const events: GoogleCalendarEvent[] = [];

    project.schedule.multiDay.forEach((day, dayIndex) => {
      day.slots.forEach((slot, slotIndex) => {
        const currentScheduleId = `${day.date}-${dayIndex}-${slotIndex}`;
        const legacyScheduleId = `${day.date}-${slotIndex}`;
        const slotName = slot.name?.trim();
        
        // If scheduleId is provided, only create event for that specific slot
        // Match either the new unique format or the legacy format
        if (scheduleId && scheduleId !== currentScheduleId && scheduleId !== legacyScheduleId) {
          return;
        }

        events.push({
          ...baseEvent,
          summary: slotName ? `${project.title} - ${slotName}` : baseEvent.summary,
          start: {
            dateTime: parseDateTime(day.date, slot.startTime, projectTimezone),
            timeZone: projectTimezone,
          },
          end: {
            dateTime: parseDateTime(day.date, slot.endTime, projectTimezone),
            timeZone: projectTimezone,
          },
        });
      });
    });

    return scheduleId ? events[0] : events;
  }

  if (
    project.event_type === "sameDayMultiArea" &&
    project.schedule.sameDayMultiArea
  ) {
    const schedule = project.schedule.sameDayMultiArea;
    const events: GoogleCalendarEvent[] = [];

    schedule.roles.forEach((role) => {
      // If scheduleId is provided, only create event for that specific role
      if (scheduleId && scheduleId !== role.name) {
        return;
      }

      events.push({
        ...baseEvent,
        summary: `${project.title} - ${role.name}`,
        start: {
          dateTime: parseDateTime(schedule.date, role.startTime, projectTimezone),
          timeZone: projectTimezone,
        },
        end: {
          dateTime: parseDateTime(schedule.date, role.endTime, projectTimezone),
          timeZone: projectTimezone,
        },
      });
    });

    return scheduleId ? events[0] : events;
  }

  return null;
}

/**
 * Get or create the "Let's Assist Volunteering" calendar
 * Returns the calendar ID
 */
async function getOrCreateVolunteeringCalendar(
  accessToken: string,
  userId: string
): Promise<string | null> {
  const supabase = await createClient();
  
  // Check if we have a stored calendar ID
  const connection = await getCalendarConnection(userId);
  if (connection?.preferences?.volunteering_calendar_id) {
    const accessState = await getGoogleCalendarAccessState(
      accessToken,
      connection.preferences.volunteering_calendar_id,
    );
    if (accessState.status === "accessible") {
      return connection.preferences.volunteering_calendar_id;
    }
    // Only a confirmed 404 authorizes replacement. Every ambiguous provider
    // outcome retains the existing calendar identity for explicit review.
    if (accessState.status !== "missing") {
      return null;
    }
  }

  // Calendar doesn't exist or isn't stored, create a new one
  try {
    const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: "Let's Assist Volunteering",
        description: "Volunteer events and shifts from Let's Assist platform",
        timeZone: "America/Los_Angeles",
      }),
    });

    if (!response.ok) {
      console.error("Failed to create personal volunteering calendar", {
        status: response.status,
      });
      return null;
    }

    const calendar = await response.json();
    const calendarId = calendar.id;

    // Set calendar color to darker green (Sage - #33B679)
    try {
      await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            colorId: "3", // Sage green in Google Calendar (one index higher than Basil)
          }),
        }
      );
    } catch {
      console.error("Failed to set personal volunteering calendar color");
      // Non-critical, continue anyway
    }

    // Store the calendar ID in the user's connection preferences
    if (connection) {
      await supabase
        .from("user_calendar_connections")
        .update({
          preferences: {
            ...connection.preferences,
            volunteering_calendar_id: calendarId,
          },
        })
        .eq("id", connection.id);
    }

    return calendarId;
  } catch (error) {
    console.error("Error creating volunteering calendar:", error);
    return null;
  }
}

async function getGoogleCalendarAccessState(
  accessToken: string,
  calendarId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleCalendarAccessState> {
  try {
    const response = await fetchImpl(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS),
      }
    );

    return classifyGoogleCalendarLookupResponse(response);
  } catch (error) {
    const state = classifyGoogleCalendarLookupError(error);
    console.error("Error checking organization calendar access:", {
      status: state.status,
      reason: state.status === "retryable_error" ? state.reason : undefined,
    });
    return state;
  }
}

export type CsfPersonalCalendarProviderContext =
  | { status: "ready"; accessToken: string; calendarId: string }
  | { status: "destination_missing" }
  | {
      status: "connection_required";
      reason: "not_connected" | "inactive" | "missing_scope" | "refresh_failed" | "provider_forbidden";
    }
  | {
      status: "unknown_outcome";
      reason:
        | "rate_limited"
        | "server_error"
        | "timeout"
        | "network_error"
        | "unknown_error"
        | "malformed_response"
        | "unexpected_status"
        | "calendar_provision_in_progress"
        | "calendar_provision_unknown"
        | "destination_state_unavailable";
      httpStatus?: number;
    }
  | { status: "rejected"; httpStatus: number };

type CsfPersonalCalendarDestinationRow = {
  state: "provisioning" | "ready" | "unknown_outcome" | "rejected";
  calendar_id: string | null;
  last_outcome_code: string | null;
};

type CsfPersonalCalendarDestinationClaim = {
  operationId: string | null;
  operationState: "started" | "confirmed" | "unknown_outcome" | "rejected";
  destinationState: CsfPersonalCalendarDestinationRow["state"] | "missing";
  calendarId: string | null;
  outcomeCode: string | null;
  shouldCallProvider: boolean;
  idempotent: boolean;
};

type CsfPersonalCalendarProviderContextOptions = {
  requestId: string;
  allowCreate: boolean;
};

function parseCsfPersonalCalendarDestinationClaim(
  value: unknown,
): CsfPersonalCalendarDestinationClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !(row.operationId === null || typeof row.operationId === "string") ||
    !["started", "confirmed", "unknown_outcome", "rejected"].includes(String(row.operationState)) ||
    !["provisioning", "ready", "unknown_outcome", "rejected", "missing"].includes(String(row.destinationState)) ||
    !(row.calendarId === null || typeof row.calendarId === "string") ||
    !(row.outcomeCode === null || typeof row.outcomeCode === "string") ||
    typeof row.shouldCallProvider !== "boolean" ||
    typeof row.idempotent !== "boolean"
  ) {
    return null;
  }
  return row as unknown as CsfPersonalCalendarDestinationClaim;
}

async function beginCsfPersonalCalendarDestinationClaim(input: {
  userId: string;
  connectionId: string;
  requestId: string;
  replaceCalendarId: string | null;
  allowCreate: boolean;
}): Promise<CsfPersonalCalendarDestinationClaim | null> {
  const admin = getAdminClient().schema("plugin_data");
  const { data, error } = await admin.rpc(
    "csf_begin_personal_calendar_destination_provision",
    {
      p_user_id: input.userId,
      p_connection_id: input.connectionId,
      p_request_id: input.requestId,
      p_replace_calendar_id: input.replaceCalendarId,
      p_allow_create: input.allowCreate,
    },
  );
  if (error) return null;
  return parseCsfPersonalCalendarDestinationClaim(data);
}

async function completeCsfPersonalCalendarDestinationClaim(input: {
  operationId: string;
  userId: string;
  outcome: "confirmed" | "unknown_outcome" | "rejected";
  calendarId: string | null;
  outcomeCode: string | null;
}): Promise<boolean> {
  const admin = getAdminClient().schema("plugin_data");
  const { error } = await admin.rpc(
    "csf_complete_personal_calendar_destination_provision",
    {
      p_operation_id: input.operationId,
      p_user_id: input.userId,
      p_outcome: input.outcome,
      p_calendar_id: input.calendarId,
      p_outcome_code: input.outcomeCode,
    },
  );
  return !error;
}

/**
 * Resolve the app-created personal calendar without exposing the credential or
 * a provider identifier to the browser. Only a confirmed 404 replaces a
 * previously tracked calendar; every ambiguous lookup stops for review.
 */
export async function getCsfPersonalCalendarProviderContext(
  userId: string,
  options: CsfPersonalCalendarProviderContextOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<CsfPersonalCalendarProviderContext> {
  const connection = await getGoogleOAuthConnectionForBinding(
    userId,
    PERSONAL_CALENDAR_GOOGLE_BINDING,
    { activeOnly: false, useServiceRole: true },
  );
  if (!connection) {
    return { status: "connection_required", reason: "not_connected" };
  }
  if (!connection.is_active) {
    return { status: "connection_required", reason: "inactive" };
  }
  if (
    !["calendar", "both"].includes(connection.connection_type ?? "") ||
    !hasGoogleCalendarWriteScope(connection.granted_scopes)
  ) {
    return { status: "connection_required", reason: "missing_scope" };
  }

  const accessToken = await getGoogleAccessTokenForUser(userId, true, {
    connectionType: "calendar",
    expectedBinding: PERSONAL_CALENDAR_GOOGLE_BINDING,
  });
  if (!accessToken) {
    return { status: "connection_required", reason: "refresh_failed" };
  }

  const admin = getAdminClient().schema("plugin_data");
  const { data: destinationData, error: destinationError } = await admin
    .from("csf_personal_calendar_destinations")
    .select("state, calendar_id, last_outcome_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (destinationError) {
    return { status: "unknown_outcome", reason: "destination_state_unavailable" };
  }

  const destination = destinationData as CsfPersonalCalendarDestinationRow | null;
  if (destination?.state === "unknown_outcome") {
    return { status: "unknown_outcome", reason: "calendar_provision_unknown" };
  }

  const storedCalendarId = destination?.state === "ready"
    && typeof destination.calendar_id === "string"
    && destination.calendar_id.trim().length > 0
    ? destination.calendar_id
    : null;
  let replaceCalendarId: string | null = null;

  if (storedCalendarId) {
    const accessState = await getGoogleCalendarAccessState(
      accessToken,
      storedCalendarId,
      fetchImpl,
    );
    if (accessState.status === "accessible") {
      return { status: "ready", accessToken, calendarId: storedCalendarId };
    }
    if (accessState.status === "forbidden") {
      return { status: "connection_required", reason: "provider_forbidden" };
    }
    if (accessState.status !== "missing") {
      return {
        status: "unknown_outcome",
        reason: accessState.reason,
        ...(accessState.httpStatus ? { httpStatus: accessState.httpStatus } : {}),
      };
    }
    replaceCalendarId = storedCalendarId;
  }

  const claim = await beginCsfPersonalCalendarDestinationClaim({
    userId,
    connectionId: connection.id,
    requestId: options.requestId,
    replaceCalendarId,
    allowCreate: options.allowCreate,
  });
  if (!claim) {
    return { status: "unknown_outcome", reason: "destination_state_unavailable" };
  }
  if (claim.destinationState === "ready" && claim.calendarId) {
    return { status: "ready", accessToken, calendarId: claim.calendarId };
  }
  if (!options.allowCreate && claim.destinationState === "missing") {
    return { status: "destination_missing" };
  }
  if (!claim.shouldCallProvider || !claim.operationId) {
    if (claim.destinationState === "rejected") {
      return { status: "rejected", httpStatus: 400 };
    }
    return {
      status: "unknown_outcome",
      reason: claim.destinationState === "provisioning"
        ? "calendar_provision_in_progress"
        : "calendar_provision_unknown",
    };
  }

  try {
    const response = await fetchImpl(`${GOOGLE_CALENDAR_API}/calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: "Let's Assist Volunteering",
        description: "Volunteer events and CSF dates you add from Let's Assist",
        timeZone: "America/Los_Angeles",
      }),
      signal: AbortSignal.timeout(GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "rejected",
        calendarId: null,
        outcomeCode: `provider_forbidden_${response.status}`,
      });
      if (!recorded) {
        return { status: "unknown_outcome", reason: "destination_state_unavailable" };
      }
      return { status: "connection_required", reason: "provider_forbidden" };
    }
    if (response.status === 408 || response.status === 429) {
      const reason = response.status === 429 ? "rate_limited" : "timeout";
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: reason,
      });
      if (!recorded) {
        return { status: "unknown_outcome", reason: "destination_state_unavailable" };
      }
      return {
        status: "unknown_outcome",
        reason,
        httpStatus: response.status,
      };
    }
    if (response.status >= 500) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: "server_error",
      });
      if (!recorded) {
        return { status: "unknown_outcome", reason: "destination_state_unavailable" };
      }
      return {
        status: "unknown_outcome",
        reason: "server_error",
        httpStatus: response.status,
      };
    }
    if (!response.ok) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "rejected",
        calendarId: null,
        outcomeCode: `provider_rejected_${response.status}`,
      });
      if (!recorded) {
        return { status: "unknown_outcome", reason: "destination_state_unavailable" };
      }
      return { status: "rejected", httpStatus: response.status };
    }

    const payload: unknown = await response.json().catch(() => null);
    const calendarId = payload && typeof payload === "object" && "id" in payload
      && typeof payload.id === "string" && payload.id.trim().length > 0
      ? payload.id
      : null;
    if (!calendarId) {
      const recorded = await completeCsfPersonalCalendarDestinationClaim({
        operationId: claim.operationId,
        userId,
        outcome: "unknown_outcome",
        calendarId: null,
        outcomeCode: "malformed_response",
      });
      if (!recorded) {
        return { status: "unknown_outcome", reason: "destination_state_unavailable" };
      }
      return { status: "unknown_outcome", reason: "malformed_response" };
    }

    const recorded = await completeCsfPersonalCalendarDestinationClaim({
      operationId: claim.operationId,
      userId,
      outcome: "confirmed",
      calendarId,
      outcomeCode: null,
    });
    if (!recorded) {
      return { status: "unknown_outcome", reason: "destination_state_unavailable" };
    }

    return { status: "ready", accessToken, calendarId };
  } catch (error) {
    const state = classifyGoogleCalendarLookupError(error);
    const reason = state.status === "retryable_error" ? state.reason : "network_error";
    const recorded = await completeCsfPersonalCalendarDestinationClaim({
      operationId: claim.operationId,
      userId,
      outcome: "unknown_outcome",
      calendarId: null,
      outcomeCode: reason,
    });
    if (!recorded) {
      return { status: "unknown_outcome", reason: "destination_state_unavailable" };
    }
    return {
      status: "unknown_outcome",
      reason,
      ...(state.status === "retryable_error" && state.httpStatus
        ? { httpStatus: state.httpStatus }
        : {}),
    };
  }
}

export async function ensureOrganizationCalendar(
  accessToken: string,
  calendarId: string | null | undefined,
  calendarName: string
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
        }
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
  scheduleId?: string
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
        }
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
        }
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
  scheduleId?: string
): Promise<boolean> {
  const eventData = formatProjectToCalendarEvent(project, scheduleId);
  if (!eventData || Array.isArray(eventData)) {
    throw new Error("Invalid project schedule data");
  }

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId
      )}/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventData),
      }
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
  eventId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId
      )}/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
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
  scheduleId?: string
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
          calendarId
        )}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventData),
        }
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
          calendarId
        )}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
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
  scheduleId?: string
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
        calendarId
      )}/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventData),
      }
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
  eventId: string
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
        calendarId
      )}/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
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
  refreshToken: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`,
      { method: "POST" }
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
      remoteRevocation = (await revokeGoogleCalendarAccess(decryptedRefreshToken))
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
  userId: string
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
  userId: string
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
  }
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
  const allowedTypes = options.connectionType === "calendar"
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
    const refreshedAuthorization = await authorizeGoogleOAuthOrganizationRequest({
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
