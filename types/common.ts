// Common types used across multiple domains

export type EventType = "oneTime" | "multiDay" | "sameDayMultiArea";
export type VerificationMethod = "qr-code" | "auto" | "manual" | "signup-only";
export type SignupStatus = "approved" | "rejected" | "pending" | "attended";
export type ProfileVisibility = 'public' | 'private' | 'organization_only';
export type ProjectVisibility = 'public' | 'unlisted' | 'organization_only';
export type ProjectStatus = "upcoming" | "in-progress" | "completed" | "cancelled";
export type OrganizationRole = "admin" | "staff" | "member";
export type ProjectWorkflowStatus = "draft" | "pending_review" | "published" | "archived";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurrenceEndType = "never" | "on_date" | "after_occurrences";
export type RecurrenceWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

// Location data with optional coordinates
export interface LocationData {
  text: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  display_name?: string;
}
