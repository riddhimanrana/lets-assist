/**
 * Server-Sent Events endpoint for streaming AI moderation scan progress
 * Analyzes reports one-by-one with detailed reasoning steps
 */

import { createServerClient } from '@supabase/ssr';
import { getServiceRoleClient } from '@/utils/supabase/service-role';
import {
  analyzeProjectWithAi,
  analyzeReportWithAi,
  buildProjectFlagDetails,
} from '@/app/admin/moderation/ai-review';
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

            const { metadata, clampedStatus, triagedAt } = await analyzeReportWithAi(
              {
                id: report.id,
                reason: report.reason,
                description: report.description,
                content_type: report.content_type,
                content_id: report.content_id,
              },
              contentDetails
            );

            // Update the report with AI metadata
            const { error: updateError } = await supabase
              .from('content_reports')
              .update({
                priority: metadata.priority,
                status: clampedStatus,
                ai_metadata: metadata,
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
                result: metadata,
              },
            });

            results.push({ type: 'report', id: report.id, result: metadata });
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
            const decision = await analyzeProjectWithAi({
              id: project.id,
              title: project.title,
              description: project.description,
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
                  flag_details: buildProjectFlagDetails(decision),
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
