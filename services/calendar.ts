/**
 * Google Calendar API integration service
 * Handles OAuth token management and calendar event operations
 */

import { createClient } from "@/lib/supabase/server";
import { getGoogleOAuthConnectionForBinding } from "@/lib/auth/google-oauth-connection-store";
import type { GoogleOAuthConnectionBindingExpectation } from "@/lib/auth/google-oauth-connection-binding";
import { hasGoogleCalendarWriteScope } from "@/lib/auth/google-oauth-scopes";
import { encrypt, decrypt } from "@/lib/encryption";
import { Project, CalendarConnection } from "@/types";
import {
  classifyGoogleCalendarLookupError,
  classifyGoogleCalendarLookupResponse,
  type GoogleCalendarAccessState,
} from "@/services/google-calendar-access-state";

// Google Calendar API endpoints
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_LOOKUP_TIMEOUT_MS = 10_000;

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

export const hasRequiredScopes = (
  grantedScopes: ScopeInput,
  requiredScopes: string[],
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
  userId: string,
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
export function isTokenExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  return expiryTime - now < fiveMinutes;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
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
export async function getValidAccessToken(
  userId: string,
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
function parseDateTime(
  dateStr: string,
  timeStr: string,
  _timezone: string,
): string {
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
export function formatProjectToCalendarEvent(
  project: Project,
  scheduleId?: string,
): GoogleCalendarEvent | GoogleCalendarEvent[] | null {
  const projectTimezone = project.project_timezone || "America/Los_Angeles";
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
        dateTime: parseDateTime(
          schedule.date,
          schedule.startTime,
          projectTimezone,
        ),
        timeZone: projectTimezone,
      },
      end: {
        dateTime: parseDateTime(
          schedule.date,
          schedule.endTime,
          projectTimezone,
        ),
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
        if (
          scheduleId &&
          scheduleId !== currentScheduleId &&
          scheduleId !== legacyScheduleId
        ) {
          return;
        }

        events.push({
          ...baseEvent,
          summary: slotName
            ? `${project.title} - ${slotName}`
            : baseEvent.summary,
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
          dateTime: parseDateTime(
            schedule.date,
            role.startTime,
            projectTimezone,
          ),
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
export async function getOrCreateVolunteeringCalendar(
  accessToken: string,
  userId: string,
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
        },
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

export async function getGoogleCalendarAccessState(
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
      },
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

export type { CsfPersonalCalendarProviderContext } from "./calendar-csf-personal";
export { getCsfPersonalCalendarProviderContext } from "./calendar-csf-personal";
export {
  createGoogleCalendarEvent,
  createGoogleCalendarEventForCalendar,
  deactivateGoogleConnection,
  deleteGoogleCalendarEvent,
  deleteGoogleCalendarEventForCalendar,
  ensureOrganizationCalendar,
  getCalendarEmail,
  getGoogleAccessToken,
  getGoogleAccessTokenForSheets,
  getGoogleAccessTokenForSheetsForUser,
  getGoogleAccessTokenForUser,
  hasActiveCalendarConnection,
  hasLegacyGoogleOAuthReconnectRequired,
  markPersonalCalendarConnectionSynced,
  revokeGoogleCalendarAccess,
  updateGoogleCalendarEvent,
  updateGoogleCalendarEventForCalendar,
} from "./calendar-operations";
