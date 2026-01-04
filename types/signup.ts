// Signup-related types
import type { SignupStatus } from './common';

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
  profile?: {
    id: string;
    full_name: string;
    username: string;
    email: string;
    phone: string;
  };
  anonymous_signup?: {
    id: string;
    name: string;
    email?: string;
    phone_number?: string;
  };
  check_in_time?: string | null;
  check_out_time?: string | null;
}

export interface ExistingAnonymousSignupQueryResult {
  id: string;
  signup_id: string | null;
  signup: {
    status: SignupStatus;
    schedule_id: string;
  }
}

export interface AnonymousSignup {
  id: string;
  project_id: string;
  email: string;
  name: string;
  phone_number?: string | null;
  token: string;
  confirmed_at?: string | null;
  created_at: string;
  signup_id: string | null;
}

export interface Signup {
  id: string;
  project_id: string;
  user_id: string | null;
  schedule_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'attended';
  created_at: string;
  updated_at: string;
  check_in_time: string | null;
  check_out_time: string | null;
  email?: string | null;
  full_name?: string | null;
  volunteer_calendar_event_id?: string | null;
  volunteer_synced_at?: string | null;
}
