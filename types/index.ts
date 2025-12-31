export type EventType = "oneTime" | "multiDay" | "sameDayMultiArea";
export type VerificationMethod = "qr-code" | "auto" | "manual" | "signup-only";
export type SignupStatus = "approved" | "rejected" | "pending" | "attended";
export type ProfileVisibility = 'public' | 'private' | 'organization_only';
export type ProjectVisibility = 'public' | 'unlisted' | 'organization_only';

// New location type to support coordinates
export interface LocationData {
  text: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  display_name?: string;
}

interface BaseScheduleSlot {
  startTime: string;
  endTime: string;
  volunteers: number;
}

export interface OneTimeSchedule extends BaseScheduleSlot {
  date: string;
}

export interface MultiDaySlot extends BaseScheduleSlot {}

export interface MultiDayScheduleDay {
  date: string;
  slots: MultiDaySlot[];
}

export interface SameDayMultiAreaRole extends BaseScheduleSlot {
  name: string;
}

export interface SameDayMultiAreaSchedule {
  date: string;
  overallStart: string;
  overallEnd: string;
  roles: SameDayMultiAreaRole[];
}

export interface ProjectSchedule {
  oneTime?: OneTimeSchedule;
  multiDay?: MultiDayScheduleDay[];
  sameDayMultiArea?: SameDayMultiAreaSchedule;
}


// Define ProjectDocument type
export interface ProjectDocument {
  name: string;
  originalName: string;
  type: string;
  size: number;
  url: string;
};

export interface VolunteerGoalsData {
  hours_goal: number;
  events_goal: number;
}

export interface Profile {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  username: string | null;
  created_at: string | null;
  volunteer_goals?: VolunteerGoalsData | null;
  profile_visibility?: ProfileVisibility | null;
  organization_id?: string | null;
}

export type ProjectStatus = "upcoming" | "in-progress" | "completed" | "cancelled";
export type OrganizationRole = "admin" | "staff" | "member";

export interface Organization {
  id: string;
  name: string;
  username: string;
  description?: string;
  logo_url?: string;
  type: string;
  verified: boolean;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  location_data?: LocationData; // New field for enhanced location data
  event_type: EventType;
  verification_method: VerificationMethod;
  require_login: boolean;
  creator_id: string;
  schedule: ProjectSchedule;
  status: ProjectStatus;
  visibility: ProjectVisibility; // Project visibility: public, unlisted, or organization_only
  organization_id?: string;
  organization?: Organization;
  pause_signups: boolean;
  created_by_role?: OrganizationRole;
  cancelled_at?: string;
  cancellation_reason?: string;
  profiles: Profile;
  created_at: string;
  cover_image_url?: string | null;
  session_id?: string | null;
  published?: Record<string, boolean>; // Track which sessions have published certificates
  certificates?: Record<string, string>; // Map of signup_id to certificate_id
  creator_calendar_event_id?: string | null; // Google Calendar event ID for project creator
  creator_synced_at?: string | null; // When the event was synced to creator's calendar
  project_timezone?: string; // Timezone where the project is happening (e.g., 'America/Los_Angeles')
}

export interface AnonymousSignupData {
  name: string;
  email?: string;
  phone?: string;
}

export interface ProjectSignup {
  id: string;
  project_id: string;
  user_id?: string | null;
  schedule_id: string;
  status: SignupStatus;
  anonymous_id?: string | null;
  anonymous_name?: string;
  anonymous_email?: string;
  anonymous_phone?: string;
  created_at: string;
  // Nested user profile when user_id is present (matches Supabase 'profile' selection)
  profile?: {
    id: string;
    full_name: string;
    username: string;
    email: string;
    phone: string;
  };
  // Nested anonymous signup data when anonymous_id is present (matches Supabase 'anonymous_signup' selection)
  anonymous_signup?: {
    id: string;
    name: string;
    email?: string;
    phone_number?: string;
  };
  // Timestamps for volunteer check-in and check-out
  check_in_time?: string | null;
  check_out_time?: string | null;
}

// Add this new interface
export interface ExistingAnonymousSignupQueryResult {
  id: string;
  signup_id: string | null; // signup_id from anonymous_signups table
  signup: { // The nested object from project_signups
    status: SignupStatus;
    schedule_id: string;
  }
}

// Add AnonymousSignup type if it's missing or incomplete
export interface AnonymousSignup {
    id: string;
    project_id: string;
    email: string;
    name: string;
    phone_number?: string | null;
    token: string;
    confirmed_at?: string | null;
    created_at: string;
    signup_id: string | null; // Foreign key to project_signups
}

// Add Signup type definition if it doesn't exist or update it
export interface Signup {
  id: string;
  project_id: string;
  user_id: string | null; // Can be null for anonymous
  schedule_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'attended';
  created_at: string;
  updated_at: string;
  check_in_time: string | null;
  check_out_time: string | null;
  email?: string | null; // For anonymous signups
  full_name?: string | null; // For anonymous signups
  volunteer_calendar_event_id?: string | null; // Google Calendar event ID for volunteer
  volunteer_synced_at?: string | null; // When the event was synced to volunteer's calendar
}

// Calendar Integration Types
export type CalendarProvider = 'google'; // Can extend to 'outlook', 'apple' in future

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  access_token: string; // Encrypted at application level
  refresh_token: string; // Encrypted at application level
  token_expires_at: string;
  calendar_email: string; // The connected Google/calendar account email
  connected_at: string;
  last_synced_at: string | null;
  is_active: boolean;
  preferences: CalendarPreferences;
  created_at: string;
  updated_at: string;
}

export interface CalendarPreferences {
  default_calendar_id?: string; // For future: which calendar to add events to
  volunteering_calendar_id?: string; // ID of the "Let's Assist Volunteering" calendar
  reminder_minutes?: number; // Default: 15 minutes
  auto_sync_new_projects?: boolean; // Auto-sync when creating projects
  auto_sync_signups?: boolean; // Auto-sync when signing up
}

export interface CalendarEvent {
  id: string; // Google Calendar event ID
  project_id: string;
  signup_id?: string; // If it's a volunteer signup event
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
