import { generateText, Output } from 'ai';
import { z } from 'zod';

type ReportStatus = 'pending' | 'under_review' | 'resolved' | 'dismissed';

type ReportAiMetadata = {
  triagedAt: string;
  verdict: string;
  shortSummary: string;
  reasoning: string;
  reasoningSteps: Array<{
    step: number;
    title: string;
    analysis: string;
    conclusion: string;
  }>;
  confidence: number;
  confidenceBreakdown?: {
    evidenceStrength: number;
    severityAssessment: number;
    contextClarity: number;
  };
  priority: 'low' | 'normal' | 'high' | 'critical';
  suggestedStatus: ReportStatus;
  recommendedAction: 'none' | 'warn_user' | 'remove_content' | 'block_content' | 'escalate_to_legal';
  actionJustification?: string;
  tags: string[];
  toolsUsed: string[];
};

const detailedReportModerationSchema = z.object({
  verdict: z.string().describe('Final triage verdict - concise summary of the decision'),
  shortSummary: z.string().describe('2-3 sentence overview of the situation for quick scanning in a table view'),
  reasoningSteps: z
    .array(
      z.object({
        step: z.number(),
        title: z.string().describe('Title of this reasoning step'),
        analysis: z.string().describe('Detailed analysis for this step'),
        conclusion: z.string().describe('Conclusion from this step'),
      })
    )
    .describe('Step-by-step chain of thought reasoning'),
  confidenceScore: z.number().min(0).max(1),
  confidenceBreakdown: z.object({
    evidenceStrength: z.number().min(0).max(1).describe('How strong is the evidence in the report?'),
    severityAssessment: z.number().min(0).max(1).describe('How severe is the potential violation?'),
    contextClarity: z.number().min(0).max(1).describe('How clear is the context provided?'),
  }),
  recommendedPriority: z.enum(['low', 'normal', 'high', 'critical']),
  recommendedStatus: z.enum(['pending', 'under_review', 'resolved', 'dismissed']),
  recommendedAction: z.enum(['none', 'warn_user', 'remove_content', 'block_content', 'escalate_to_legal']),
  actionJustification: z.string().describe('Why this specific action is recommended'),
  tags: z
    .array(
      z.enum([
        'spam',
        'harassment',
        'inappropriate_content',
        'misinformation',
        'copyright',
        'privacy_violation',
        'violence',
        'hate_speech',
        'other',
      ])
    )
    .default([]),
  toolsUsed: z.array(z.string()).default([]).describe('List of conceptual tools/checks performed'),
});

const detailedProjectModerationSchema = z.object({
  isFlagged: z.boolean(),
  flagType: z
    .enum(['spam', 'harassment', 'inappropriate', 'violence', 'hate_speech', 'sexual', 'other'])
    .optional(),
  shortSummary: z.string().describe('2-3 sentence overview for quick scanning'),
  confidenceScore: z.number().min(0).max(1),
  reasoningSteps: z.array(
    z.object({
      step: z.number(),
      title: z.string(),
      analysis: z.string(),
      conclusion: z.string(),
    })
  ),
  verdict: z.string(),
  toolsUsed: z.array(z.string()).default([]),
});

type DetailedReportDecision = z.infer<typeof detailedReportModerationSchema>;
type DetailedProjectDecision = z.infer<typeof detailedProjectModerationSchema>;

type ReportInput = {
  id: string;
  reason: string | null;
  description: string | null;
  content_type: string;
  content_id: string;
};

type ProjectInput = {
  id: string;
  title: string | null;
  description: string | null;
};

function normalizeReportStatus(value: string): ReportStatus {
  const allowed: ReportStatus[] = ['pending', 'under_review', 'resolved', 'dismissed'];
  return allowed.includes(value as ReportStatus) ? (value as ReportStatus) : 'pending';
}

function clampReportStatus(value: ReportStatus): ReportStatus {
  if (value === 'resolved' || value === 'dismissed') {
    return 'under_review';
  }
  return value;
}

function buildReportReasoning(decision: DetailedReportDecision) {
  if (!decision.reasoningSteps?.length) {
    return decision.verdict;
  }
  return decision.reasoningSteps.map((step) => `${step.title}: ${step.conclusion}`).join(' → ');
}

function buildReportAiMetadata(
  decision: DetailedReportDecision,
  triagedAt: string,
  suggestedStatus: ReportStatus
): ReportAiMetadata {
  return {
    triagedAt,
    verdict: decision.verdict,
    shortSummary: decision.shortSummary,
    reasoning: buildReportReasoning(decision),
    reasoningSteps: decision.reasoningSteps,
    confidence: decision.confidenceScore,
    confidenceBreakdown: decision.confidenceBreakdown,
    priority: decision.recommendedPriority,
    suggestedStatus,
    recommendedAction: decision.recommendedAction,
    actionJustification: decision.actionJustification,
    tags: decision.tags,
    toolsUsed: decision.toolsUsed,
  };
}

function buildProjectFlagDetails(decision: DetailedProjectDecision) {
  return {
    reasoning: decision.verdict,
    verdict: decision.verdict,
    shortSummary: decision.shortSummary,
    reasoningSteps: decision.reasoningSteps,
    toolsUsed: decision.toolsUsed,
  };
}

async function analyzeReportWithAi(report: ReportInput, contentDetails: string) {
  const { output: decision } = await generateText({
    model: 'openai/gpt-oss-safeguard-20b',
    output: Output.object({ schema: detailedReportModerationSchema }),
    prompt: `You are an expert content moderation AI for a volunteer platform. Analyze this user report with detailed step-by-step reasoning.

## Report Details
- Report ID: ${report.id}
- Reason for Report: ${report.reason}
- Reporter's Description: ${report.description}
- Content Type: ${report.content_type}

## Content Being Reported
${contentDetails || 'Content details not available'}

## Your Task
1. Understand the context of what's being reported
2. Assess the severity of the potential violation
3. Check if the evidence supports the claim
4. Consider if this is malicious or a misunderstanding
5. Recommend appropriate action

Provide your analysis step-by-step, then give a final verdict with recommended action.

Think through each step carefully:
- Step 1: Context Understanding - What is the situation?
- Step 2: Evidence Assessment - What evidence exists?
- Step 3: Severity Evaluation - How serious is this?
- Step 4: Intent Analysis - Is this intentional or accidental?
- Step 5: Action Recommendation - What should moderators do?

Include "toolsUsed" with conceptual tools like: "content_analysis", "policy_check", "context_verification", "severity_scoring", "user_history_review" (even if simulated).`,
  });

  const normalizedStatus = normalizeReportStatus(decision.recommendedStatus);
  const clampedStatus = clampReportStatus(normalizedStatus);
  const triagedAt = new Date().toISOString();
  const metadata = buildReportAiMetadata(decision, triagedAt, clampedStatus);

  return { decision, metadata, clampedStatus, triagedAt };
}

async function analyzeProjectWithAi(project: ProjectInput) {
  const { output: decision } = await generateText({
    model: 'openai/gpt-oss-safeguard-20b',
    output: Output.object({ schema: detailedProjectModerationSchema }),
    prompt: `You are an expert content moderation AI for a volunteer platform. Analyze this project with detailed step-by-step reasoning.

## Project Details
- Project ID: ${project.id}
- Title: ${project.title}
- Description: ${project.description}

## Your Task
Determine if this project violates any policies (spam, harassment, inappropriate content, violence, hate speech, sexual content, etc.).

Provide step-by-step analysis:
- Step 1: Content Analysis - What does this project describe?
- Step 2: Policy Check - Does it violate any policies?
- Step 3: Context Verification - Is this legitimate volunteer work?
- Step 4: Final Decision - Should this be flagged?

Include "toolsUsed" with conceptual tools used in analysis.`,
  });

  return decision;
}

export {
  analyzeProjectWithAi,
  analyzeReportWithAi,
  buildProjectFlagDetails,
  buildReportAiMetadata,
  clampReportStatus,
  detailedProjectModerationSchema,
  detailedReportModerationSchema,
  normalizeReportStatus,
};

export type { DetailedProjectDecision, DetailedReportDecision, ReportAiMetadata, ReportStatus };
