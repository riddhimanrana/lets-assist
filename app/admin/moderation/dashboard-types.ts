export type AiReasoningStep = {
  step: number;
  title: string;
  analysis: string;
  conclusion: string;
};

export type AiConfidenceBreakdown = {
  evidenceStrength: number;
  severityAssessment: number;
  contextClarity: number;
};

export type AiMetadata = {
  triagedAt?: string | null;
  verdict?: string;
  shortSummary?: string;
  reasoning?: string;
  reasoningSteps?: AiReasoningStep[];
  confidence?: number;
  confidenceBreakdown?: AiConfidenceBreakdown;
  priority?: string | null;
  suggestedStatus?: string | null;
  recommendedAction?: string | null;
  actionJustification?: string;
  tags?: string[];
  toolsUsed?: string[];
};

export type ContentDetails = {
  id?: string;
  title?: string | null;
  name?: string | null;
  creator_id?: string | null;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type ContentReport = {
  id: string;
  content_id?: string;
  content_type?: string;
  reason?: string | null;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  created_at?: string | null;
  resolution_notes?: string | null;
  reporter?: {
    id?: string;
    full_name?: string | null;
    username?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
  reporter_id?: string | null;
  reporter_label?: string | null;
  user_id?: string | null;
  ai_metadata?: AiMetadata | null;
  content_snapshot?: Record<string, unknown> | null;
  content_details?: ContentDetails | null;
  creator_details?: ContentDetails | null;
};

export type FlaggedContent = {
  id: string;
  content_id?: string;
  content_type?: string;
  status?: string | null;
  flag_type?: string | null;
  confidence_score?: number | string | null;
  flag_details?: {
    verdict?: string;
    shortSummary?: string;
    reasoning?: string;
    reasoningSteps?: AiReasoningStep[];
    toolsUsed?: string[];
  } | null;
  severity?: string;
  reason?: string;
  categories?: Record<string, boolean> | null;
  content_details?: ContentDetails | null;
  creator_details?: ContentDetails | null;
  created_at?: string | null;
};

export type FlaggedFilter = "pending" | "blocked" | "confirmed" | "dismissed";
export type ReportsFilter =
  "pending" | "under_review" | "resolved" | "dismissed";

export type ModerationStats = {
  total: number;
  pending: number;
  pendingFlags: number;
  pendingReports: number;
  resolved: number;
  aiApproved: number;
  automationLast24h: number;
  automationTotal: number;
  lastAutomationAt?: string | null;
  blocked: number;
  critical: number;
  recentWeek: number;
  monthlyActivity: number;
};

export type ReportsStats = {
  total: number;
  pending: number;
  resolved: number;
  highPriority: number;
  recentWeek: number;
};

// SSE event types
export type ScanEvent = {
  type: "start" | "progress" | "analyzing" | "result" | "complete" | "error";
  data: {
    totalReports?: number;
    totalProjects?: number;
    totalItems?: number;
    processed?: number;
    total?: number;
    percentComplete?: number;
    itemType?: "report" | "project";
    itemId?: string;
    itemTitle?: string;
    reporterName?: string;
    current?: number;
    success?: boolean;
    flagged?: boolean;
    result?: AiMetadata | Record<string, unknown>;
    error?: string;
    message?: string;
    reportsProcessed?: number;
    projectsProcessed?: number;
  };
};

export const REPORT_RESOLVE_NOTE = "Resolved via moderation dashboard";
export const REPORT_DISMISS_NOTE = "Dismissed via moderation dashboard";

export type ScanProgress = {
  current: number;
  total: number;
  percentComplete: number;
  currentItem?: string;
  currentItemType?: string;
  reportsProcessed: number;
  projectsProcessed: number;
};

export type ScanResult = {
  itemType: string;
  itemId: string;
  success: boolean;
  flagged?: boolean;
  result?: AiMetadata | Record<string, unknown>;
  error?: string;
};
