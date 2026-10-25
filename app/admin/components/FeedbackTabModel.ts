export type ModerationStatus = "pending" | "approved" | "flagged" | "archived";

export type ModerateResult = { error?: string; success?: boolean } | void;

export const statusLabel: Record<ModerationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  flagged: "Flagged",
  archived: "Archived",
};

export function getValidDate(input: string | null | undefined) {
  if (!input) return null;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

export interface FeedbackItem {
  id: string;
  section: string;
  title: string;
  feedback: string;
  rating?: number | null;
  purpose?: string;
  context_kind?: string | null;
  created_at: string;
  email: string;
  page_path?: string | null;
  metadata?: Record<string, unknown> | null;
  moderation_status?: ModerationStatus;
  moderation_notes?: string | null;
  moderation_reviewed_at?: string | null;
  moderation_reviewed_by?: string | null;
  profiles?: {
    full_name: string | null;
    avatar_url?: string | null;
    username?: string | null;
  } | null;
}

export interface FeedbackTabProps {
  feedback: FeedbackItem[];
  onDelete?: (id: string) => Promise<void>;
  onModerate?: (
    id: string,
    status: ModerationStatus,
  ) => Promise<ModerateResult>;
}

export type FeedbackCounts = Record<"total" | ModerationStatus, number>;
