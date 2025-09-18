export type EventType = "oneTime" | "multiDay" | "sameDayMultiArea";
export type VerificationMethod = "qr-code" | "auto" | "manual" | "signup-only";
export type SignupStatus = "approved" | "rejected" | "pending" | "attended";

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
  trusted_member?: boolean | null;
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
  is_private: boolean; // Changed from visibility to is_private boolean
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
  // Add other relevant fields if needed
}
