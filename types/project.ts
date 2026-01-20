// Project-related types
import type { 
  EventType, 
  VerificationMethod, 
  ProjectStatus, 
  ProjectVisibility,
  OrganizationRole,
  LocationData,
  ProjectWorkflowStatus,
  RecurrenceFrequency,
  RecurrenceEndType,
  RecurrenceWeekday
} from './common';
import type { ProjectSchedule } from './schedule';
import type { Profile } from './profile';
import type { Organization } from './organization';

// Project document attachment
export interface ProjectDocument {
  name: string;
  originalName: string;
  type: string;
  size: number;
  url: string;
}

export interface RecurrenceRule {
  frequency?: RecurrenceFrequency;
  interval?: number;
  end_type?: RecurrenceEndType;
  end_date?: string;
  end_occurrences?: number;
  weekdays?: RecurrenceWeekday[];
}

export interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  location_data?: LocationData;
  event_type: EventType;
  verification_method: VerificationMethod;
  require_login: boolean;
  enable_volunteer_comments?: boolean;
  show_attendees_publicly?: boolean;
  waiver_required?: boolean;
  waiver_allow_upload?: boolean;
  waiver_pdf_url?: string | null;
  waiver_pdf_storage_path?: string | null;
  creator_id: string;
  schedule: ProjectSchedule;
  status: ProjectStatus;
  visibility: ProjectVisibility;
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
  published?: Record<string, boolean>;
  certificates?: Record<string, string>;
  creator_calendar_event_id?: string | null;
  creator_synced_at?: string | null;
  project_timezone?: string;
  workflow_status?: ProjectWorkflowStatus;
  recurrence_rule?: RecurrenceRule;
  recurrence_parent_id?: string;
  recurrence_sequence?: number;
}
