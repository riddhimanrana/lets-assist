/**
 * Server-Sent Events endpoint for streaming AI moderation scan progress
 * Analyzes reports one-by-one with detailed reasoning steps
 */

import { createServerClient } from '@supabase/ssr';
import { getServiceRoleClient } from '@/utils/supabase/service-role';
import { generateObject } from 'ai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

// Helper to fetch auth user from Supabase
async function fetchAuthUser(userId: string) {
  const adminClient = getServiceRoleClient();
  const { data } = await adminClient.auth.admin.getUserById(userId);
  return data?.user;
}

// Check if user is super admin using auth metadata
async function checkSuperAdmin() {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      }
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log('[scan-stream] No authenticated user found:', authError?.message);
      return { isAdmin: false, user: null };
    }
    
    // Check auth user's is_super_admin flag
    try {
      const authUser = await fetchAuthUser(user.id);
      const isSuperAdmin =
        (authUser as unknown as { is_super_admin?: boolean } | null)?.is_super_admin === true ||
        authUser?.user_metadata?.is_super_admin === true ||
        authUser?.app_metadata?.is_super_admin === true;
      
      console.log('[scan-stream] Auth check:', { userId: user.id, isSuperAdmin });
      return { isAdmin: isSuperAdmin, user };
    } catch (error) {
      console.error('[scan-stream] Error checking auth user:', error);
      return { isAdmin: false, user: null };
    }
  } catch (error) {
    console.error('[scan-stream] Auth check failed:', error);
    return { isAdmin: false, user: null };
  }
}

// Enhanced schema with detailed reasoning steps
const detailedReportModerationSchema = z.object({
  verdict: z.string().describe("Final triage verdict - concise summary of the decision"),
  shortSummary: z.string().describe("2-3 sentence overview of the situation for quick scanning in a table view"),
  reasoningSteps: z.array(z.object({
    step: z.number(),
    title: z.string().describe("Title of this reasoning step"),
    analysis: z.string().describe("Detailed analysis for this step"),
    conclusion: z.string().describe("Conclusion from this step"),
  })).describe("Step-by-step chain of thought reasoning"),
  confidenceScore: z.number().min(0).max(1),
  confidenceBreakdown: z.object({
    evidenceStrength: z.number().min(0).max(1).describe("How strong is the evidence in the report?"),
    severityAssessment: z.number().min(0).max(1).describe("How severe is the potential violation?"),
    contextClarity: z.number().min(0).max(1).describe("How clear is the context provided?"),
  }),
  recommendedPriority: z.enum(['low', 'normal', 'high', 'critical']),
  recommendedStatus: z.enum(['pending', 'under_review', 'resolved', 'dismissed']),
  recommendedAction: z.enum(['none', 'warn_user', 'remove_content', 'block_content', 'escalate_to_legal']),
  actionJustification: z.string().describe("Why this specific action is recommended"),
  tags: z.array(z.enum([
    'spam', 'harassment', 'inappropriate_content', 'misinformation', 
    'copyright', 'privacy_violation', 'violence', 'hate_speech', 'other'
  ])).default([]),
  toolsUsed: z.array(z.string()).default([]).describe("List of conceptual tools/checks performed"),
});

// Schema for project moderation
const detailedProjectModerationSchema = z.object({
  isFlagged: z.boolean(),
  flagType: z.enum(['spam', 'harassment', 'inappropriate', 'violence', 'hate_speech', 'sexual', 'other']).optional(),
  shortSummary: z.string().describe("2-3 sentence overview for quick scanning"),
  confidenceScore: z.number().min(0).max(1),
  reasoningSteps: z.array(z.object({
    step: z.number(),
    title: z.string(),
    analysis: z.string(),
    conclusion: z.string(),
  })),
  verdict: z.string(),
  toolsUsed: z.array(z.string()).default([]),
});

type AiMetadata = {
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
  suggestedStatus: 'pending' | 'under_review' | 'resolved' | 'dismissed';
  recommendedAction: 'none' | 'warn_user' | 'remove_content' | 'block_content' | 'escalate_to_legal';
  actionJustification?: string;
  tags: string[];
  toolsUsed: string[];
};

type ScanEvent = {
  type: 'start' | 'progress' | 'analyzing' | 'result' | 'complete' | 'error';
  data: unknown;
};

function sendEvent(controller: ReadableStreamDefaultController, event: ScanEvent) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

export async function GET(_request: NextRequest) {
  const { isAdmin } = await checkSuperAdmin();
  
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const supabase = getServiceRoleClient();

        // Fetch pending reports
        const { data: pendingReports, error: reportsError } = await supabase
          .from('content_reports')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(25);

        if (reportsError) {
          sendEvent(controller, { type: 'error', data: { message: reportsError.message } });
          controller.close();
          return;
        }

        // Manually fetch reporter profiles
        const reporterIds = (pendingReports ?? [])
          .map((r) => r.reporter_id)
          .filter((id): id is string => id !== null);
        
        const { data: reporterProfiles } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .in('id', reporterIds);
        
        const profileMap = new Map(reporterProfiles?.map(p => [p.id, p]) || []);
        
        // Enrich reports with reporter data
        const reportsWithReporter = (pendingReports ?? []).map(report => ({
          ...report,
          reporter: profileMap.get(report.reporter_id),
        }));

        // Filter out already-triaged reports
        const reportCandidates = reportsWithReporter.filter((report) => {
          const hasAiMetadata = report.ai_metadata?.triagedAt;
          const hasAiNote = report.resolution_notes?.includes('[AI triage]');
          return !hasAiMetadata && !hasAiNote;
        });

        // Fetch recent projects for scanning
        const { data: projectsData, error: projectsError } = await supabase
          .from('projects')
          .select('id, title, description')
          .order('created_at', { ascending: false })
          .limit(20);

        if (projectsError) {
          sendEvent(controller, { type: 'error', data: { message: projectsError.message } });
          controller.close();
          return;
        }

        // Filter out already-flagged projects
        const projectList = projectsData ?? [];
        let flaggedIds = new Set<string>();

        if (projectList.length > 0) {
          const { data: existingFlags } = await supabase
            .from('content_flags')
            .select('content_id')
            .eq('content_type', 'project')
            .in('content_id', projectList.map((p) => p.id));

          flaggedIds = new Set(existingFlags?.map((f) => f.content_id) ?? []);
        }

        const projectCandidates = projectList.filter(
          (p) => p.description?.trim() && !flaggedIds.has(p.id)
        );

        const totalItems = reportCandidates.length + projectCandidates.length;

        sendEvent(controller, {
          type: 'start',
          data: {
            totalReports: reportCandidates.length,
            totalProjects: projectCandidates.length,
            totalItems,
          },
        });

        if (totalItems === 0) {
          sendEvent(controller, {
            type: 'complete',
            data: {
              message: 'No new items to scan',
              reportsProcessed: 0,
              projectsProcessed: 0,
            },
          });
          controller.close();
          return;
        }

        let processedCount = 0;
        const results: Array<{ type: 'report' | 'project'; id: string; result: unknown }> = [];

        // Process each report one by one
        for (const report of reportCandidates) {
          sendEvent(controller, {
            type: 'analyzing',
            data: {
              itemType: 'report',
              itemId: report.id,
              itemTitle: `Report: ${report.reason}`,
              current: processedCount + 1,
              total: totalItems,
              reporterName: report.reporter?.full_name || report.reporter?.username || 'Anonymous',
            },
          });

          try {
            // Fetch content details for context
            let contentDetails = '';
            if (report.content_type === 'project') {
              const { data: project } = await supabase
                .from('projects')
                .select('title, description')
                .eq('id', report.content_id)
                .single();
              
              if (project) {
                contentDetails = `Project Title: ${project.title}\nProject Description: ${project.description || 'N/A'}`;
              }
            } else if (report.content_type === 'organization') {
              const { data: org } = await supabase
                .from('organizations')
                .select('name, description')
                .eq('id', report.content_id)
                .single();
              
              if (org) {
                contentDetails = `Organization Name: ${org.name}\nOrganization Description: ${org.description || 'N/A'}`;
              }
            }

            const { object: decision } = await generateObject({
              model: 'openai/gpt-oss-safeguard-20b',
              schema: detailedReportModerationSchema,
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

            // Normalize status to prevent invalid values
            const normalizedStatus = ['pending', 'under_review', 'resolved', 'dismissed'].includes(decision.recommendedStatus)
              ? decision.recommendedStatus
              : 'pending';
            
            // Clamp status - AI shouldn't fully resolve/dismiss without human review
            const clampedStatus = normalizedStatus === 'resolved' || normalizedStatus === 'dismissed'
              ? 'under_review'
              : normalizedStatus;

            const triagedAt = new Date().toISOString();
            const aiMetadata: AiMetadata = {
              triagedAt,
              verdict: decision.verdict,
              shortSummary: decision.shortSummary,
              reasoning: decision.reasoningSteps.map(s => `${s.title}: ${s.conclusion}`).join(' → '),
              reasoningSteps: decision.reasoningSteps,
              confidence: decision.confidenceScore,
              confidenceBreakdown: decision.confidenceBreakdown,
              priority: decision.recommendedPriority,
              suggestedStatus: clampedStatus,
              recommendedAction: decision.recommendedAction,
              actionJustification: decision.actionJustification,
              tags: decision.tags,
              toolsUsed: decision.toolsUsed,
            };

            // Update the report with AI metadata
            const { error: updateError } = await supabase
              .from('content_reports')
              .update({
                priority: aiMetadata.priority,
                status: clampedStatus,
                ai_metadata: aiMetadata,
                updated_at: triagedAt,
              })
              .eq('id', report.id);

            if (updateError) {
              console.error(`Failed to update report ${report.id}:`, updateError);
            }

            sendEvent(controller, {
              type: 'result',
              data: {
                itemType: 'report',
                itemId: report.id,
                success: !updateError,
                result: aiMetadata,
              },
            });

            results.push({ type: 'report', id: report.id, result: aiMetadata });
          } catch (aiError) {
            console.error(`AI analysis failed for report ${report.id}:`, aiError);
            sendEvent(controller, {
              type: 'result',
              data: {
                itemType: 'report',
                itemId: report.id,
                success: false,
                error: aiError instanceof Error ? aiError.message : 'Unknown error',
              },
            });
          }

          processedCount++;
          sendEvent(controller, {
            type: 'progress',
            data: {
              processed: processedCount,
              total: totalItems,
              percentComplete: Math.round((processedCount / totalItems) * 100),
            },
          });
        }

        // Process each project one by one
        for (const project of projectCandidates) {
          sendEvent(controller, {
            type: 'analyzing',
            data: {
              itemType: 'project',
              itemId: project.id,
              itemTitle: project.title,
              current: processedCount + 1,
              total: totalItems,
            },
          });

          try {
            const { object: decision } = await generateObject({
              model: 'openai/gpt-oss-safeguard-20b',
              schema: detailedProjectModerationSchema,
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

            if (decision.isFlagged) {
              const { error: flagError } = await supabase
                .from('content_flags')
                .insert({
                  content_type: 'project',
                  content_id: project.id,
                  flag_type: decision.flagType ?? 'other',
                  confidence_score: decision.confidenceScore,
                  flag_source: 'ai',
                  flag_details: {
                    reasoning: decision.verdict,
                    reasoningSteps: decision.reasoningSteps,
                    shortSummary: decision.shortSummary,
                    toolsUsed: decision.toolsUsed,
                  },
                  status: 'pending',
                });

              if (flagError) {
                console.error(`Failed to flag project ${project.id}:`, flagError);
              }
            }

            sendEvent(controller, {
              type: 'result',
              data: {
                itemType: 'project',
                itemId: project.id,
                projectTitle: project.title,
                success: true,
                flagged: decision.isFlagged,
                result: decision,
              },
            });

            results.push({ type: 'project', id: project.id, result: decision });
          } catch (aiError) {
            console.error(`AI analysis failed for project ${project.id}:`, aiError);
            sendEvent(controller, {
              type: 'result',
              data: {
                itemType: 'project',
                itemId: project.id,
                success: false,
                error: aiError instanceof Error ? aiError.message : 'Unknown error',
              },
            });
          }

          processedCount++;
          sendEvent(controller, {
            type: 'progress',
            data: {
              processed: processedCount,
              total: totalItems,
              percentComplete: Math.round((processedCount / totalItems) * 100),
            },
          });
        }

        // Send completion event
        sendEvent(controller, {
          type: 'complete',
          data: {
            message: 'AI scan completed successfully',
            reportsProcessed: reportCandidates.length,
            projectsProcessed: projectCandidates.length,
            totalProcessed: processedCount,
            results,
          },
        });

        controller.close();
      } catch (error) {
        console.error('AI moderation scan stream failed:', error);
        sendEvent(controller, {
          type: 'error',
          data: {
            message: error instanceof Error ? error.message : 'Unknown error occurred',
          },
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
