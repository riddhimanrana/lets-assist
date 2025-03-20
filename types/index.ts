export type EventType = "oneTime" | "multiDay" | "sameDayMultiArea";
export type VerificationMethod = "qr-code" | "auto" | "manual";

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

export interface Profile {
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  created_at: string | null;
}

export type ProjectStatus = "upcoming" | "in-progress" | "completed" | "cancelled";
export type ProjectVisibility = "public" | "organization";
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
  event_type: EventType;
  verification_method: VerificationMethod;
  require_login: boolean;
  creator_id: string;
  schedule: ProjectSchedule;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  organization_id?: string;
  organization?: Organization;
  created_by_role?: OrganizationRole;
  cancelled_at?: string;
  cancellation_reason?: string;
  profiles: Profile;
  created_at: string;
  cover_image_url?: string | null;
}
