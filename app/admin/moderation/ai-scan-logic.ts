/**
 * Shared AI moderation scan logic that can be called from both
 * the cron job and admin actions without making HTTP requests
 */

import { getAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { isPendingReportStatus } from './report-status';
import {
  chunkModerationItems,
  generateModerationObject,
  sanitizeModerationText,
} from './ai-generation';

// Schema for AI moderation response with Chain of Thought
const moderationSchema = z.object({
  isFlagged: z.boolean(),
  flagType: z.enum(['spam', 'harassment', 'inappropriate', 'violence', 'hate_speech', 'sexual', 'other']).optional(),
  confidenceScore: z.number().min(0).max(1),
  reasoning: z.string().describe("Chain of thought reasoning for the decision"),
  verdict: z.string().describe("Final short verdict"),
});

const reportModerationSchema = z.object({
  verdict: z.string().describe("Final triage verdict"),
  reasoning: z.string().describe("Explain why the verdict was chosen"),
  confidenceScore: z.number().min(0).max(1),
  recommendedPriority: z.enum(['low', 'normal', 'high', 'critical']).describe("How urgent this report is"),
  recommendedStatus: z.enum(['pending', 'under_review', 'resolved', 'dismissed']).describe("What workflow status moderators should use next - pending: awaiting review, under_review: actively investigating, resolved: issue handled, dismissed: not a violation"),
  recommendedAction: z.enum(['none', 'warn_user', 'remove_content', 'block_content', 'escalate_to_legal']).optional().describe("Recommended moderator action to take"),
  tags: z.array(z.enum(['spam','harassment','inappropriate_content','misinformation','copyright','privacy_violation','violence','hate_speech','other'])).default([]),
});

const projectModerationOutputSchema = moderationSchema.extend({
  id: z.string().describe('ID of the project being evaluated'),
});

const reportModerationOutputSchema = reportModerationSchema.extend({
  id: z.string().describe('ID of the content report being evaluated'),
});

const batchModerationSchema = z.object({
  projects: z.array(projectModerationOutputSchema).default([]),
  reports: z.array(reportModerationOutputSchema).default([]),
});

type BatchModerationResult = z.infer<typeof batchModerationSchema>;

type ReportPriority = 'low' | 'normal' | 'high' | 'critical';
type ReportStatus = 'pending' | 'under_review' | 'resolved' | 'dismissed' | 'escalated';

type ReportAiMetadata = {
  triagedAt: string;
  verdict: string;
  reasoning: string;
  confidence: number;
  priority: ReportPriority;
  suggestedStatus: ReportStatus;
  tags: string[];
  recommendedAction?: 'none' | 'warn_user' | 'remove_content' | 'block_content' | 'escalate_to_legal';
};

const AI_TRIAGE_NOTE_PREFIX = '[AI triage]';

function normalizeStatus(value: string): ReportStatus {
  const allowed: ReportStatus[] = ['pending', 'under_review', 'resolved', 'dismissed'];
  return allowed.includes(value as ReportStatus) ? (value as ReportStatus) : 'pending';
}

function clampStatusForAi(value: ReportStatus): ReportStatus {
  if (value === 'resolved' || value === 'dismissed') {
    return 'under_review';
  }
  return value;
}

function buildAiNote(existing: string | null | undefined, metadata: ReportAiMetadata) {
  const summary = `${AI_TRIAGE_NOTE_PREFIX} ${metadata.triagedAt}: ${metadata.verdict} (confidence ${(metadata.confidence * 100).toFixed(0)}%, priority ${metadata.priority}). ${metadata.reasoning}`;
  return existing ? `${existing}\n\n${summary}` : summary;
}

type RawContentReport = {
  id: string;
  reason: string;
  description: string;
  priority?: string | null;
  status: string;
  content_type: string;
  content_id: string;
  resolution_notes?: string | null;
  ai_metadata?: Partial<ReportAiMetadata> | null;
};

type ModerationBatchPayload = {
  projects: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  reports: Array<{
    id: string;
    reason: string;
    description: string;
    contentType: string;
  }>;
};

const SCAN_BATCH_SIZE = 5;
const MAX_PROMPT_TEXT_CHARS = 1000;

function buildBatchPrompt(aiPayload: ModerationBatchPayload) {
  return `You are a content moderation AI. Review the following user-generated content and flag any that violate policies (spam, harassment, inappropriate content, violence, hate speech, etc.). Be thorough but fair.

Projects (volunteer initiatives):
${aiPayload.projects
  .map(
    (p) =>
      `- ID: ${p.id}\n  Title: ${p.title}\n  Description: ${p.description}`
  )
  .join('\n')}

Content Reports (user complaints):
${aiPayload.reports
  .map(
    (r) =>
      `- ID: ${r.id}\n  Reason Reported: ${r.reason}\n  Report Description: ${r.description}`
  )
  .join('\n')}

Return a batch result with flagged projects and triaged reports.`;
}

function toBatchPayload(
  projects: Array<{ id: string; title: string | null; description: string | null }>,
  reports: RawContentReport[]
): ModerationBatchPayload {
  return {
    projects: projects.map((project) => ({
      id: project.id,
      title: sanitizeModerationText(project.title, MAX_PROMPT_TEXT_CHARS) || 'Untitled project',
      description:
        sanitizeModerationText(project.description, MAX_PROMPT_TEXT_CHARS) || 'No description provided',
    })),
    reports: reports.map((report) => ({
      id: report.id,
      reason: sanitizeModerationText(report.reason, MAX_PROMPT_TEXT_CHARS) || 'No reason provided',
      description:
        sanitizeModerationText(report.description, MAX_PROMPT_TEXT_CHARS) || 'No description provided',
      contentType: report.content_type,
    })),
  };
}

export async function performAiModerationScan() {
  try {
    const supabase = getAdminClient();

    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('id, title, description')
      .order('created_at', { ascending: false })
      .limit(20);

    if (projectsError) throw projectsError;

    const projectList = projectsData ?? [];
    let flaggedIds = new Set<string>();

    if (projectList.length > 0) {
      const { data: existingFlags, error: flagsError } = await supabase
        .from('content_flags')
        .select('content_id')
        .eq('content_type', 'project')
        .in('content_id', projectList.map((project) => project.id));

      if (flagsError) throw flagsError;
      flaggedIds = new Set(existingFlags?.map((flag) => flag.content_id) ?? []);
    }

    const projectCandidates = projectList.filter(
      (project) => project.description?.trim() && !flaggedIds.has(project.id)
    );

    const { data: reportsData, error: reportsError } = await supabase
      .from('content_reports')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(200);

    if (reportsError) throw reportsError;

    const pendingReports = ((reportsData ?? []) as RawContentReport[])
      .filter((report) => isPendingReportStatus(report.status))
      .slice(0, 25);

    const reportCandidates = pendingReports.filter((report) => {
      if (!report.description?.trim()) {
        return false;
      }

      const alreadyTriaged = Boolean(report.ai_metadata?.triagedAt) ||
        (typeof report.resolution_notes === 'string' && report.resolution_notes.includes(AI_TRIAGE_NOTE_PREFIX));

      return !alreadyTriaged;
    });

    if (projectCandidates.length === 0 && reportCandidates.length === 0) {
      return {
        success: true,
        moderated: 0,
        results: { projects: [], reports: [] },
        applied: {
          projectFlags: [],
          reportTriages: [],
        },
        message: 'No new items to scan',
      };
    }

    const projectBatches = chunkModerationItems(projectCandidates, SCAN_BATCH_SIZE);
    const reportBatches = chunkModerationItems(reportCandidates, SCAN_BATCH_SIZE);
    const batchCount = Math.max(projectBatches.length, reportBatches.length);

    const appliedProjectFlags: Array<{ projectId: string; result: unknown }> = [];
    const appliedReportTriages: Array<{ reportId: string; result: ReportAiMetadata }> = [];
    const allBatchResults: BatchModerationResult = { projects: [], reports: [] };
    const scanWarnings: string[] = [];
    const reportMap = new Map(reportCandidates.map((r) => [r.id, r]));

    for (let index = 0; index < batchCount; index += 1) {
      const batchPayload = toBatchPayload(projectBatches[index] ?? [], reportBatches[index] ?? []);

      if (batchPayload.projects.length === 0 && batchPayload.reports.length === 0) {
        continue;
      }

      try {
        const batchResult = await generateModerationObject({
          label: 'ai-moderation-scan',
          schema: batchModerationSchema,
          prompt: buildBatchPrompt(batchPayload),
        });

        allBatchResults.projects.push(...batchResult.projects);
        allBatchResults.reports.push(...batchResult.reports);

        for (const decision of batchResult.projects) {
          if (!decision.isFlagged) {
            continue;
          }

          const { error: flagError } = await supabase
            .from('content_flags')
            .insert({
              content_type: 'project',
              content_id: decision.id,
              flag_type: decision.flagType ?? 'other',
              confidence_score: decision.confidenceScore,
              flag_source: 'ai',
              flag_details: {
                reasoning: decision.reasoning,
                verdict: decision.verdict,
              },
              status: 'pending',
            });

          if (flagError) {
            console.error(`Failed to flag project ${decision.id}:`, flagError);
            continue;
          }

          appliedProjectFlags.push({ projectId: decision.id, result: decision });
        }

        for (const decision of batchResult.reports) {
          const report = reportMap.get(decision.id);
          if (!report) {
            continue;
          }

          const triagedAt = new Date().toISOString();
          const suggestedStatus = clampStatusForAi(normalizeStatus(decision.recommendedStatus));
          const metadata: ReportAiMetadata = {
            triagedAt,
            verdict: decision.verdict,
            reasoning: decision.reasoning,
            confidence: decision.confidenceScore,
            priority: decision.recommendedPriority,
            suggestedStatus,
            tags: decision.tags ?? [],
            recommendedAction: decision.recommendedAction ?? 'none',
          };

          const baseUpdate = {
            priority: metadata.priority,
            status: suggestedStatus,
            updated_at: triagedAt,
          };

          const { error: updateError } = await supabase
            .from('content_reports')
            .update({
              ...baseUpdate,
              resolution_notes: buildAiNote(report.resolution_notes, metadata),
            })
            .eq('id', report.id);

          if (updateError) {
            console.error(`Failed to update report ${report.id}:`, updateError);
            continue;
          }

          appliedReportTriages.push({ reportId: report.id, result: metadata });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        scanWarnings.push(`Batch ${index + 1} failed: ${message}`);
        console.error(`AI moderation batch ${index + 1} failed:`, error);
      }
    }

    const appliedCount = appliedProjectFlags.length + appliedReportTriages.length;

    if (appliedCount === 0 && scanWarnings.length > 0) {
      throw new Error(scanWarnings[0]);
    }

    return {
      success: true,
      moderated: appliedCount,
      scanned: {
        projects: projectCandidates.length,
        reports: reportCandidates.length,
      },
      results: allBatchResults,
      applied: {
        projectFlags: appliedProjectFlags,
        reportTriages: appliedReportTriages,
      },
      ...(scanWarnings.length > 0 ? { warnings: scanWarnings } : {}),
    };
  } catch (error) {
    console.error('AI moderation scan failed:', error);
    throw error;
  }
}
