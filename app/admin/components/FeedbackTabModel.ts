export type ModerationStatus = "pending" | "approved" | "flagged" | "archived";

export type ModerateResult = { error?: string; success?: boolean } | void;

export const statusStyles: Record<ModerationStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  approved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  flagged: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  archived: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

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
