/**
 * Google Calendar API integration service
 * Handles OAuth token management and calendar event operations
 */

import { createClient } from "@/utils/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import {
  Project,
  CalendarConnection,
  OneTimeSchedule,
  MultiDayScheduleDay,
  SameDayMultiAreaSchedule,
} from "@/types";

// Google Calendar API endpoints
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

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
 * Get user's active calendar connection
 */
export async function getCalendarConnection(
  userId: string
): Promise<CalendarConnection | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("provider", "google")
    .single();

  if (error || !data) {
    return null;
  }

  return data as CalendarConnection;
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
      console.error("Failed to refresh token:", await response.text());
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
function parseDateTime(dateStr: string, timeStr: string, timezone: string): string {
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://letsassist.app";
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
        const currentScheduleId = `${day.date}-${slotIndex}`;
        
        // If scheduleId is provided, only create event for that specific slot
        if (scheduleId && scheduleId !== currentScheduleId) {
          return;
        }

        events.push({
          ...baseEvent,
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
    // Verify the calendar still exists
    try {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.preferences.volunteering_calendar_id)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      if (response.ok) {
        return connection.preferences.volunteering_calendar_id;
      }
    } catch (error) {
      console.error("Error checking existing calendar:", error);
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
      const error = await response.text();
      console.error("Failed to create calendar:", error);
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
            colorId: "11", // Sage green in Google Calendar (one index higher than Basil)
          }),
        }
      );
    } catch (error) {
      console.error("Failed to set calendar color:", error);
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
