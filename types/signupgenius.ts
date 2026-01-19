import type { EventType, ProjectSchedule, ProjectVisibility } from "./common";

export interface SignupGeniusSignupSummary {
  id: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  signupUrl?: string;
  raw: Record<string, unknown>;
}

export interface SignupGeniusSlot {
  id?: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  quantity?: number;
  filled?: number;
  remaining?: number;
  raw: Record<string, unknown>;
}

export interface SignupGeniusImportPreview {
  signup: SignupGeniusSignupSummary;
  eventType: EventType;
  schedule: ProjectSchedule;
  slots: SignupGeniusSlot[];
  warnings: string[];
  blockingIssues: string[];
  suggestedVisibility: ProjectVisibility;
}

export interface SignupGeniusImportResult {
  preview?: SignupGeniusImportPreview;
  signups?: SignupGeniusSignupSummary[];
  error?: string;
}

export interface SignupGeniusImportOptions {
  organizationId?: string;
  visibility?: ProjectVisibility;
  requireLogin?: boolean;
}
