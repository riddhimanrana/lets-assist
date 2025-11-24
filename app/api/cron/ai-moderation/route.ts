import { getServiceRoleClient } from '@/utils/supabase/service-role';
import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';

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
  recommendedStatus: z.enum(['pending', 'under_review', 'escalated', 'dismissed']).describe("What workflow status moderators should use next"),
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
};

const AI_TRIAGE_NOTE_PREFIX = '[AI triage]';

function normalizeStatus(value: string): ReportStatus {
  const allowed: ReportStatus[] = ['pending', 'under_review', 'resolved', 'dismissed', 'escalated'];
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

export async function GET(_request: Request) {
  try {
    const supabase = getServiceRoleClient();

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

    const { data: pendingReports, error: reportsError } = await supabase
      .from('content_reports')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(25);

    if (reportsError) throw reportsError;

    const reportCandidates = ((pendingReports ?? []) as RawContentReport[]).filter((report) => {
      if (!report.description?.trim()) {
        return false;
      }

      const alreadyTriaged = Boolean(report.ai_metadata?.triagedAt) ||
        (typeof report.resolution_notes === 'string' && report.resolution_notes.includes(AI_TRIAGE_NOTE_PREFIX));

      return !alreadyTriaged;
    });

    if (projectCandidates.length === 0 && reportCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        moderated: 0,
        results: { projects: [], reports: [] },
        message: 'No new items to scan',
      });
    }

    const aiPayload = {
      projects: projectCandidates.map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
      })),
      reports: reportCandidates.map((report) => ({
        id: report.id,
        reason: report.reason,
        description: report.description,
        contentType: report.content_type,
        existingPriority: report.priority || 'normal',
      })),
    };

    const serializedPayload = JSON.stringify(aiPayload, null, 2);

    const { object: batchResult } = await generateObject({
      model: 'openai/gpt-oss-safeguard-20b',
      schema: batchModerationSchema,
      prompt: `You are a Trust & Safety AI that evaluates volunteer projects and community reports.
Return a JSON response that matches the schema exactly. Produce one entry for every project and every report provided, even when there is no issue (set isFlagged to false).
Keep the reasoning concise but reference policy categories when possible.

Items to evaluate (JSON):
${serializedPayload}`,
    });

    const projectMap = new Map(projectCandidates.map((project) => [project.id, project]));
    const reportMap = new Map(reportCandidates.map((report) => [report.id, report]));

    const appliedProjectFlags: Array<{ projectId: string; result: z.infer<typeof projectModerationOutputSchema> }> = [];
    const appliedReportTriages: Array<{ reportId: string; result: ReportAiMetadata }> = [];

    for (const decision of batchResult.projects) {
      const project = projectMap.get(decision.id);
      if (!project || !decision.isFlagged) {
        continue;
      }

      const { error: insertError } = await supabase
        .from('content_flags')
        .insert({
          content_type: 'project',
          content_id: project.id,
          flag_type: decision.flagType || 'other',
          confidence_score: decision.confidenceScore,
          reason: decision.verdict,
          status: 'pending',
          is_ai_flagged: true,
          flag_details: {
            reasoning: decision.reasoning,
            full_analysis: decision,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error(`Failed to insert flag for project ${project.id}:`, insertError);
        continue;
      }

      appliedProjectFlags.push({ projectId: project.id, result: decision });
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
          ai_metadata: metadata,
        })
        .eq('id', report.id);

      if (updateError) {
        console.error(`Failed to store AI metadata for report ${report.id}, falling back:`, updateError);

        const { error: fallbackError } = await supabase
          .from('content_reports')
          .update({
            ...baseUpdate,
            resolution_notes: buildAiNote(report.resolution_notes, metadata),
          })
          .eq('id', report.id);

        if (fallbackError) {
          console.error(`Fallback update also failed for report ${report.id}:`, fallbackError);
          continue;
        }
      }

      appliedReportTriages.push({ reportId: report.id, result: metadata });
    }

    const appliedCount = appliedProjectFlags.length + appliedReportTriages.length;

    return NextResponse.json({
      success: true,
      moderated: appliedCount,
      scanned: {
        projects: aiPayload.projects.length,
        reports: aiPayload.reports.length,
      },
      results: batchResult,
      applied: {
        projectFlags: appliedProjectFlags,
        reportTriages: appliedReportTriages,
      },
    });
  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
