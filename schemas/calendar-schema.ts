import { z } from "zod";

// Calendar Provider Schema
export const calendarProviderSchema = z.enum(["google"]);

// Calendar Connection Schema
export const calendarConnectionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: calendarProviderSchema,
  access_token: z.string(),
  refresh_token: z.string(),
  token_expires_at: z.string().datetime(),
  calendar_email: z.string().email(),
  connected_at: z.string().datetime(),
  last_synced_at: z.string().datetime().nullable(),
  is_active: z.boolean(),
  preferences: z
    .object({
      default_calendar_id: z.string().optional(),
      reminder_minutes: z.number().int().min(0).max(10080).optional(), // Max 1 week
      auto_sync_new_projects: z.boolean().optional(),
      auto_sync_signups: z.boolean().optional(),
    })
    .optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// OAuth Callback Schema
export const oauthCallbackSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  state: z.string().optional(),
});

// Sync Project to Calendar Schema
export const syncProjectSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  schedule_id: z.string().optional(), // Optional: specific slot/role to sync
});

// Sync Signup to Calendar Schema
export const syncSignupSchema = z.object({
  signup_id: z.string().uuid("Invalid signup ID"),
  project_id: z.string().uuid("Invalid project ID"),
  schedule_id: z.string().min(1, "Schedule ID is required"),
});

// Remove Event from Calendar Schema
export const removeCalendarEventSchema = z.object({
  event_id: z.string().min(1, "Calendar event ID is required"),
  event_type: z.enum(["creator", "volunteer"]),
});

// Update Calendar Preferences Schema
export const updateCalendarPreferencesSchema = z.object({
  default_calendar_id: z.string().optional(),
  reminder_minutes: z.number().int().min(0).max(10080).optional(),
  auto_sync_new_projects: z.boolean().optional(),
  auto_sync_signups: z.boolean().optional(),
});

// Disconnect Calendar Schema
export const disconnectCalendarSchema = z.object({
  provider: calendarProviderSchema,
  revoke_access: z.boolean().default(true), // Whether to revoke OAuth access
});

// Generate iCal Schema
export const generateICalSchema = z.object({
  project_id: z.string().uuid("Invalid project ID"),
  schedule_id: z.string().optional(),
});

// Google Calendar Event Response Schema (for validation)
export const googleCalendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  htmlLink: z.string().url(),
  status: z.string(),
  created: z.string(),
  updated: z.string(),
});

// Token Response Schema (Google OAuth)
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
});

// Calendar Event Data Schema (for creating events)
export const calendarEventDataSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  location: z.string().optional(),
  start_time: z.string().datetime("Invalid start time"),
  end_time: z.string().datetime("Invalid end time"),
  timezone: z.string().default("America/New_York"),
  reminders: z
    .object({
      useDefault: z.boolean().default(false),
      overrides: z
        .array(
          z.object({
            method: z.enum(["email", "popup"]),
            minutes: z.number().int().min(0),
          })
        )
        .optional(),
    })
    .optional(),
});

// Synced Event Schema
export const syncedEventSchema = z.object({
  id: z.string(),
  project_id: z.string().uuid(),
  project_title: z.string(),
  schedule_id: z.string(),
  event_type: z.enum(["creator", "volunteer"]),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  synced_at: z.string().datetime(),
  calendar_event_id: z.string(),
});

export type CalendarProvider = z.infer<typeof calendarProviderSchema>;
export type OAuthCallback = z.infer<typeof oauthCallbackSchema>;
export type SyncProject = z.infer<typeof syncProjectSchema>;
export type SyncSignup = z.infer<typeof syncSignupSchema>;
export type RemoveCalendarEvent = z.infer<typeof removeCalendarEventSchema>;
export type UpdateCalendarPreferences = z.infer<typeof updateCalendarPreferencesSchema>;
export type DisconnectCalendar = z.infer<typeof disconnectCalendarSchema>;
export type GenerateICal = z.infer<typeof generateICalSchema>;
export type GoogleCalendarEvent = z.infer<typeof googleCalendarEventSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type CalendarEventData = z.infer<typeof calendarEventDataSchema>;
export type SyncedEvent = z.infer<typeof syncedEventSchema>;
