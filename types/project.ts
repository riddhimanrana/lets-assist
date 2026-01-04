// Project-related types
import type { 
  EventType, 
  VerificationMethod, 
  ProjectStatus, 
  ProjectVisibility,
  OrganizationRole,
  LocationData 
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

export interface Project {
  id: string;
  title: string;
  description: string;
  location: string;
  location_data?: LocationData;
  event_type: EventType;
  verification_method: VerificationMethod;
  require_login: boolean;
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
}
