// Calendar integration types

export type CalendarProvider = 'google'; // Can extend to 'outlook', 'apple' in future

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  calendar_email: string;
  connected_at: string;
  last_synced_at: string | null;
  is_active: boolean;
  preferences: CalendarPreferences;
  created_at: string;
  updated_at: string;
}

export interface CalendarPreferences {
  default_calendar_id?: string;
  volunteering_calendar_id?: string;
  reminder_minutes?: number;
  auto_sync_new_projects?: boolean;
  auto_sync_signups?: boolean;
}

export interface CalendarEvent {
  id: string;
  project_id: string;
  signup_id?: string;
  schedule_id: string;
  event_type: 'creator' | 'volunteer';
  synced_at: string;
  last_updated: string;
}

export interface SyncedEvent {
  id: string;
  project_id: string;
  project_title: string;
  schedule_id: string;
  event_type: 'creator' | 'volunteer';
  start_time: string;
  end_time: string;
  synced_at: string;
  calendar_event_id: string;
}
