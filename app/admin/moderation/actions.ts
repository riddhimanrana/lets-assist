"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkSuperAdmin } from "../actions";
import { NotificationService } from "@/services/notifications";
import { notifyAdminsBatched } from "@/services/admin-notifications";
import { sendEmail } from "@/services/email";
import ContentModerationActionEmail from "@/emails/content-moderation-action";
import {
  analyzeProjectWithAi,
  analyzeReportWithAi,
  buildProjectFlagDetails,
} from "./ai-review";

/**
 * Get all flagged content for admin review
 */
export async function getFlaggedContent(status?: 'pending' | 'blocked' | 'confirmed' | 'dismissed') {
  const supabase = getAdminClient();
  
  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  let query = supabase
    .from('content_flags')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching flagged content:', error);
    return { error: error.message };
  }

  const flags = data ?? [];

  const projectIds = flags
    .filter((flag) => flag.content_type === 'project')
    .map((flag) => flag.content_id);
  const profileIds = flags
    .filter((flag) => flag.content_type === 'profile')
    .map((flag) => flag.content_id);
  const organizationIds = flags
    .filter((flag) => flag.content_type === 'organization')
    .map((flag) => flag.content_id);

  let projects: Array<{ id: string; title: string | null; creator_id: string | null; organization_id: string | null }> = [];
  let profiles: Array<{ id: string; full_name: string | null; username: string | null; avatar_url: string | null; email?: string | null }> = [];
  let organizations: Array<{ id: string; name: string | null; username: string | null; created_by: string | null }> = [];

  if (projectIds.length > 0) {
    const { data: projectData } = await supabase
      .from('projects')
      .select('id, title, creator_id, organization_id')
      .in('id', projectIds);
    projects = projectData || [];
  }

  if (profileIds.length > 0) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, email')
      .in('id', profileIds);
    profiles = profileData || [];
  }

  if (organizationIds.length > 0) {
    const { data: orgData } = await supabase
      .from('organizations')
      .select('id, name, username, created_by')
      .in('id', organizationIds);
    organizations = orgData || [];
  }

  const creatorIds = new Set<string>();
  projects.forEach((project) => {
    if (project.creator_id) {
      creatorIds.add(project.creator_id);
    }
  });
  organizations.forEach((org) => {
    if (org.created_by) {
      creatorIds.add(org.created_by);
    }
  });

  const creatorProfiles = creatorIds.size
    ? await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, email')
        .in('id', Array.from(creatorIds))
    : { data: [] };

  const creatorMap = new Map((creatorProfiles.data || []).map((profile) => [profile.id, profile]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const orgMap = new Map(organizations.map((org) => [org.id, org]));

  const enriched = flags.map((flag) => {
    const details = (flag.flag_details || {}) as Record<string, unknown>;
    let contentDetails: Record<string, unknown> | null = null;
    let creatorDetails: Record<string, unknown> | null = null;

    if (flag.content_type === 'project') {
      const project = projectMap.get(flag.content_id);
      if (project) {
        contentDetails = project;
        if (project.creator_id) {
          creatorDetails = creatorMap.get(project.creator_id) || null;
        }
      }
    } else if (flag.content_type === 'profile') {
      const profile = profileMap.get(flag.content_id);
      if (profile) {
        contentDetails = profile;
        creatorDetails = profile;
      }
    } else if (flag.content_type === 'organization') {
      const org = orgMap.get(flag.content_id);
      if (org) {
        contentDetails = org;
        if (org.created_by) {
          creatorDetails = creatorMap.get(org.created_by) || null;
        }
      }
    }

    return {
      ...flag,
      severity: deriveSeverity(flag.confidence_score),
      reason:
        details.shortSummary ||
        details.verdict ||
        details.reasoning ||
        flag.flag_type ||
        'Flagged content',
      categories: flag.flagged_categories || null,
      content_details: contentDetails,
      creator_details: creatorDetails,
      profiles: creatorDetails,
    };
  });

  return { data: enriched };
}

/**
 * Get moderation logs for a specific user
 */
export async function getUserModerationLogs(_userId: string) {
  // moderation_logs table doesn't exist yet, return empty array
  return { data: [] };
}

/**
 * Update flagged content status
 */
export async function updateFlaggedContentStatus(
  id: string,
  status: 'pending' | 'blocked' | 'confirmed' | 'dismissed',
  reviewNotes?: string
) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await viewerSupabase.auth.getUser();

  const { data: existingFlags, error: checkError } = await supabase
    .from('content_flags')
    .select('id')
    .eq('id', id);

  if (checkError) {
    console.error('Error checking flagged content:', id, checkError);
    return { error: `Failed to check flagged content: ${checkError.message}` };
  }

  if (!existingFlags || existingFlags.length === 0) {
    console.error('Flagged content not found:', id);
    return { error: "Flagged content not found" };
  }

  const { data, error } = await supabase
    .from('content_flags')
    .update({ 
      status,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq('id', id)
    .select();
  
  if (error) {
    console.error('Error updating flagged content:', error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    console.error('No data returned after update for flagged content:', id);
    return { error: "Failed to update flagged content" };
  }

  const updatedFlag = data[0];

  if (status === 'blocked' && updatedFlag?.content_id && updatedFlag?.content_type) {
    await softRemoveContent(
      supabase,
      updatedFlag.content_type,
      updatedFlag.content_id,
      'block_content',
      user?.id || 'system',
      reviewNotes || `Flagged for ${updatedFlag.flag_type || 'policy violation'}`
    );

    await notifyContentOwnerOfModeration({
      supabase,
      contentType: updatedFlag.content_type,
      contentId: updatedFlag.content_id,
      action: 'block_content',
      reason: reviewNotes || updatedFlag.flag_type || 'Policy violation',
    });
  }

  if (updatedFlag?.content_id && updatedFlag?.content_type && updatedFlag?.flag_type) {
    await notifyAdminsBatched({
      type: 'flagged_content',
      contentId: updatedFlag.content_id,
      contentType: updatedFlag.content_type,
      flagType: updatedFlag.flag_type,
      confidenceScore: updatedFlag.confidence_score,
    });
  }

  return { data: updatedFlag };
}

/**
 * Get moderation statistics
 */
export async function getModerationStats() {
  const supabase = getAdminClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  // Get total counts from content_flags
  const { count: totalFlagged } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true });
  
  // Get total count from content_reports (ALL reports, not just pending)
  const { count: totalReportsCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true });
  
  const { count: pendingFlagsCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  // Also count pending content_reports
  const { count: pendingReportsCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  const { count: blockedCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'blocked');
  
  // Get critical count - high priority reports + high confidence flags
  const { count: criticalFlagsCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .gte('confidence_score', 0.8);
  
  const { count: criticalReportsCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .in('priority', ['high', 'critical']);
  
  // Get recent violations (last 7 days) from both tables
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { count: recentFlagsCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString());
  
  const { count: recentReportsCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString());
  
  // Combine stats from both tables
  const totalPending = (pendingFlagsCount || 0) + (pendingReportsCount || 0);
  const totalCritical = (criticalFlagsCount || 0) + (criticalReportsCount || 0);
  const totalRecent = (recentFlagsCount || 0) + (recentReportsCount || 0);
  
  return {
    data: {
      total: (totalFlagged || 0) + (totalReportsCount || 0),
      pending: totalPending,
      blocked: blockedCount || 0,
      critical: totalCritical,
      recentWeek: totalRecent,
      monthlyActivity: 0,
    }
  };
}

/**
 * Get repeat offenders (users with multiple violations)
 */
export async function getRepeatOffenders() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  // content_flags doesn't have user_id, so this function is not applicable yet
  return { data: [] };
}

type ProjectSummary = {
  id: string;
  title: string | null;
  creator_id: string | null;
};

type ProfileSummary = {
  id: string;
  full_name: string | null;
  email?: string | null;
  username: string | null;
  avatar_url: string | null;
};

/**
 * Get all content reports for admin review
 */
export async function getContentReports(status?: 'pending' | 'under_review' | 'resolved' | 'dismissed' | 'escalated') {
  const supabase = getAdminClient();
  
  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  let query = supabase
    .from('content_reports')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query;
  
  console.log(`[getContentReports] Fetched ${data?.length || 0} reports with status: ${status || 'any'}`);
  if (data?.length) {
    console.log(`[getContentReports] Report IDs:`, data.map(r => r.id));
  }
  
  if (error) {
    console.error('Error fetching content reports:', error);
    return { error: error.message };
  }
  
  // Manually fetch reporter and reviewer profiles
  if (data) {
    const reporterIds = data
      .map(r => r.reporter_id)
      .filter((id): id is string => id !== null);
    
    const reviewerIds = data
      .map(r => r.reviewed_by)
      .filter((id): id is string => id !== null);
    
    const allUserIds = [...new Set([...reporterIds, ...reviewerIds])];
    
    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, username')
        .in('id', allUserIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Fetch content details based on type
      const projectIds = data.filter(r => r.content_type === 'project').map(r => r.content_id);
      const profileIds = data.filter(r => r.content_type === 'profile').map(r => r.content_id);
      
      let projects: ProjectSummary[] = [];
      if (projectIds.length > 0) {
        const { data: p } = await supabase
          .from('projects')
          .select('id, title, creator_id')
          .in('id', projectIds);
        projects = p || [];
      }

      let profilesContent: ProfileSummary[] = [];
      if (profileIds.length > 0) {
        const { data: p } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', profileIds);
        profilesContent = p || [];
      }

      // Fetch creators for projects
      const projectCreatorIds = projects.map(p => p.creator_id).filter(Boolean);
      let projectCreators: ProfileSummary[] = [];
      if (projectCreatorIds.length > 0) {
        const { data: pc } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', projectCreatorIds);
        projectCreators = pc || [];
      }

      const projectCreatorMap = new Map(projectCreators.map(p => [p.id, p]));

      // Enhance data with profile info and content details
      const enhancedData = data.map(report => {
        let contentDetails = null;
        let creatorDetails = null;

        if (report.content_type === 'project') {
          const project = projects.find(p => p.id === report.content_id);
          contentDetails = project;
          if (project && project.creator_id) {
            creatorDetails = projectCreatorMap.get(project.creator_id);
          }
        } else if (report.content_type === 'profile') {
          const profile = profilesContent.find(p => p.id === report.content_id);
          contentDetails = profile;
          creatorDetails = profile;
        }

        return {
          ...report,
          reporter: report.reporter_id ? profileMap.get(report.reporter_id) : null,
          reviewer: report.reviewed_by ? profileMap.get(report.reviewed_by) : null,
          content_details: contentDetails,
          creator_details: creatorDetails,
        };
      });
      
      return { data: enhancedData };
    }
  }
  
  return { data };
}

/**
 * Update content report status
 */
export async function updateContentReportStatus(
  id: string,
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed',
  resolutionNotes?: string
) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient(); // Use service role to bypass RLS
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await viewerSupabase.auth.getUser();
  
  // First check if the report exists (using service role)
  const { data: existingReports, error: checkError } = await supabase
    .from('content_reports')
    .select('id')
    .eq('id', id);
  
  if (checkError) {
    console.error('Error checking report:', id, checkError);
    return { error: `Failed to check report: ${checkError.message}` };
  }

  if (!existingReports || existingReports.length === 0) {
    console.error('Report not found:', id);
    return { error: "Report not found" };
  }
  
  const { data, error } = await supabase
    .from('content_reports')
    .update({ 
      status,
      reviewed_by: user?.id,
      reviewed_at: status === 'resolved' || status === 'dismissed' ? new Date().toISOString() : null,
      resolution_notes: resolutionNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();
  
  if (error) {
    console.error('Error updating content report:', error);
    return { error: error.message };
  }
  
  if (!data || data.length === 0) {
    console.error('No data returned after update for report:', id);
    return { error: "Failed to update report" };
  }
  
  return { data: data[0] };
}

/**
 * Send feedback to a user regarding their report
 */
type ReportSummary = {
  description?: string | null;
  reason?: string | null;
};

export async function sendReportFeedback(
  reportId: string,
  userId: string | null | undefined,
  message: string,
  status: 'resolved' | 'investigating' | 'dismissed',
  reportSummary?: ReportSummary
) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const {
    data: { user },
  } = await viewerSupabase.auth.getUser();

  const resolvedAt = new Date().toISOString();
  const normalizedStatus = status === 'investigating' ? 'under_review' : status;

  const { data: updateData, error: updateError } = await supabase
    .from('content_reports')
    .update({
      status: normalizedStatus,
      resolution_notes: message,
      reviewed_by: user?.id ?? null,
      reviewed_at: resolvedAt,
      updated_at: resolvedAt,
    })
    .eq('id', reportId)
    .select('id');

  if (updateError) {
    return { error: updateError.message };
  }
  
  if (!updateData || updateData.length === 0) {
    return { error: "Report not found" };
  }

  if (userId) {
    await NotificationService.createNotification(
      {
        title: "Update on your report",
        body: message,
        type: "general",
        severity: "info",
        data: {
          modalType: "report-feedback",
          reportId,
          message,
          status: normalizedStatus,
          resolvedAt,
          reportDescription: reportSummary?.description,
          reportReason: reportSummary?.reason,
        },
      },
      userId
    );
  }

  return { success: true };
}

/**
 * Get content reports statistics
 */
export async function getContentReportsStats() {
  const supabase = getAdminClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  // Get total counts
  const { count: totalReports } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true });
  
  const { count: pendingCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  const { count: resolvedCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'resolved');
  
  const { count: highPriorityCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .in('priority', ['high', 'critical']);
  
  // Get recent reports (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { count: recentCount } = await supabase
    .from('content_reports')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString());
  
  return {
    data: {
      total: totalReports || 0,
      pending: pendingCount || 0,
      resolved: resolvedCount || 0,
      highPriority: highPriorityCount || 0,
      recentWeek: recentCount || 0,
    }
  };
}

/**
 * Run AI review for a single content report
 */
export async function runAiReviewForReport(reportId: string) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: { user } } = await viewerSupabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: report, error: reportError } = await supabase
    .from('content_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();

  if (reportError) {
    console.error('Error fetching report for AI review:', reportError);
    return { error: reportError.message };
  }

  if (!report) {
    return { error: 'Report not found' };
  }

  let contentDetails = '';
  if (report.content_type === 'project') {
    const { data: project } = await supabase
      .from('projects')
      .select('title, description')
      .eq('id', report.content_id)
      .maybeSingle();
    if (project) {
      contentDetails = `Project Title: ${project.title}\nProject Description: ${project.description || 'N/A'}`;
    }
  } else if (report.content_type === 'organization') {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, description')
      .eq('id', report.content_id)
      .maybeSingle();
    if (org) {
      contentDetails = `Organization Name: ${org.name}\nOrganization Description: ${org.description || 'N/A'}`;
    }
  } else if (report.content_type === 'profile') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, username')
      .eq('id', report.content_id)
      .maybeSingle();
    if (profile) {
      contentDetails = `Profile: ${profile.full_name || profile.username || 'Unknown user'}`;
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
    console.error('Error updating report after AI review:', updateError);
    return { error: updateError.message };
  }

  return { data: metadata };
}

/**
 * Run AI review for a single project
 */
export async function runAiReviewForProject(projectId: string) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: { user } } = await viewerSupabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, title, description')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) {
    console.error('Error fetching project for AI review:', projectError);
    return { error: projectError.message };
  }

  if (!project) {
    return { error: 'Project not found' };
  }

  const decision = await analyzeProjectWithAi({
    id: project.id,
    title: project.title,
    description: project.description,
  });

  if (!decision.isFlagged) {
    return { data: { flagged: false, decision } };
  }

  const { data: existingFlags, error: existingError } = await supabase
    .from('content_flags')
    .select('id, status')
    .eq('content_type', 'project')
    .eq('content_id', project.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingError) {
    console.error('Error checking existing flags:', existingError);
    return { error: existingError.message };
  }

  const flagPayload = {
    flag_type: decision.flagType ?? 'other',
    confidence_score: decision.confidenceScore,
    flag_details: buildProjectFlagDetails(decision),
  };

  if (existingFlags && existingFlags.length > 0) {
    const { error: updateError } = await supabase
      .from('content_flags')
      .update({
        ...flagPayload,
      })
      .eq('id', existingFlags[0].id);

    if (updateError) {
      console.error('Error updating existing flag after AI review:', updateError);
      return { error: updateError.message };
    }

    return { data: { flagged: true, decision } };
  }

  const { error: insertError } = await supabase
    .from('content_flags')
    .insert({
      content_type: 'project',
      content_id: project.id,
      flag_source: 'ai',
      status: 'pending',
      ...flagPayload,
    });

  if (insertError) {
    console.error('Error inserting new flag after AI review:', insertError);
    return { error: insertError.message };
  }

  await notifyAdminsBatched({
    type: 'flagged_content',
    contentId: project.id,
    contentType: 'project',
    flagType: decision.flagType ?? 'other',
    confidenceScore: decision.confidenceScore,
  });

  return { data: { flagged: true, decision } };
}

/**
 * Apply the AI recommendation for a report
 */
export async function applyAiRecommendationForReport(reportId: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: report, error } = await supabase
    .from('content_reports')
    .select('id, reason, ai_metadata')
    .eq('id', reportId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching report for AI action:', error);
    return { error: error.message };
  }

  if (!report) {
    return { error: 'Report not found' };
  }

  const recommendedAction = report.ai_metadata?.recommendedAction as
    | 'none'
    | 'warn_user'
    | 'remove_content'
    | 'block_content'
    | 'escalate_to_legal'
    | undefined;

  if (!recommendedAction || recommendedAction === 'none') {
    return { error: 'No actionable AI recommendation available' };
  }

  const reason =
    report.ai_metadata?.actionJustification ||
    report.ai_metadata?.shortSummary ||
    report.reason ||
    'Applied AI recommendation';

  return takeModeratorAction(reportId, recommendedAction, reason);
}

/**
 * Take a manual moderator action on flagged content
 */
export async function takeFlaggedContentAction(
  flagId: string,
  action: 'warn_user' | 'remove_content' | 'block_content' | 'dismiss',
  reason?: string
) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient();

  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: { user } } = await viewerSupabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data: flag, error: flagError } = await supabase
    .from('content_flags')
    .select('*')
    .eq('id', flagId)
    .maybeSingle();

  if (flagError) {
    console.error('Error fetching flagged content:', flagError);
    return { error: flagError.message };
  }

  if (!flag) {
    return { error: 'Flagged content not found' };
  }

  let newStatus: 'pending' | 'blocked' | 'confirmed' | 'dismissed' = 'pending';
  switch (action) {
    case 'dismiss':
      newStatus = 'dismissed';
      break;
    case 'block_content':
      newStatus = 'blocked';
      break;
    case 'remove_content':
    case 'warn_user':
    default:
      newStatus = 'confirmed';
      break;
  }

  const { data, error } = await supabase
    .from('content_flags')
    .update({
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reason || `Action ${action}`,
    })
    .eq('id', flagId)
    .select();

  if (error) {
    console.error('Error updating flagged content:', error);
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    return { error: 'Failed to update flagged content' };
  }

  if ((action === 'remove_content' || action === 'block_content') && flag.content_id && flag.content_type) {
    await softRemoveContent(
      supabase,
      flag.content_type,
      flag.content_id,
      action,
      user.id,
      reason
    );
  }

  if (action === 'remove_content' || action === 'block_content' || action === 'warn_user') {
    await notifyContentOwnerOfModeration({
      supabase,
      contentType: flag.content_type,
      contentId: flag.content_id,
      action,
      reason: reason || flag.flag_type || 'Policy violation',
    });
  }

  return { data: data[0] };
}

/**
 * Trigger an AI moderation scan manually
 */
export async function runAiScan() {
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  try {
    const { performAiModerationScan } = await import('./ai-scan-logic');
    const result = await performAiModerationScan();
    if (result?.applied?.projectFlags?.length || result?.applied?.reportTriages?.length) {
      await notifyAdminsBatched({
        type: 'flagged_content',
        contentId: 'batch',
        contentType: 'ai_scan',
        flagType: 'scan_results',
      });
    }
    return { success: true, data: result };
  } catch (e) {
    console.error('AI scan exception:', e);
    return { error: `Scan failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
  }
}

/**
 * Get detailed information about a content report with all context
 * Includes: report details, content details, creator/reporter profiles, etc.
 */
export async function getDetailedReportWithContext(reportId: string) {
  const supabase = getAdminClient();
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required", data: undefined };
  }

  try {
    console.log(`[getDetailedReportWithContext] Fetching report: ${reportId}`);
    
    // Get the report
    const { data: reportList, error: reportError } = await supabase
      .from('content_reports')
      .select('*')
      .eq('id', reportId);

    console.log(`[getDetailedReportWithContext] Query result:`, { 
      reportList, 
      reportError,
      count: reportList?.length 
    });

    if (reportError) {
      console.error(`[getDetailedReportWithContext] Error:`, reportError);
      return { error: `Failed to fetch report: ${reportError.message}`, data: undefined };
    }

    if (!reportList || reportList.length === 0) {
      console.error(`[getDetailedReportWithContext] Report not found with ID: ${reportId}`);
      return { error: "Report not found", data: undefined };
    }

    const report = reportList[0];
    console.log(`[getDetailedReportWithContext] Found report:`, { id: report.id, status: report.status });

    // Get reporter profile
    const { data: reporterList } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .eq('id', report.reporter_id);

    const reporterProfile = reporterList?.[0] || null;

    // Get reviewer profile if reviewed
    const { data: reviewerList } = report.reviewed_by
      ? await supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('id', report.reviewed_by)
      : { data: null };

    const reviewerProfile = reviewerList?.[0] || null;

    // Get content details based on content_type
    let contentDetails: unknown = null;
    let creatorProfile = null;

    if (report.content_type === 'project') {
      const { data: projectList } = await supabase
        .from('projects')
        .select('id, title, description, creator_id, organization_id, status, created_at')
        .eq('id', report.content_id);

      const project = projectList?.[0];
      if (project) {
        contentDetails = project;
        const { data: creatorList } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .eq('id', project.creator_id);
        creatorProfile = creatorList?.[0] || null;

        // Get organization if exists
        if (project.organization_id) {
          const { data: orgList } = await supabase
            .from('organizations')
            .select('id, name, username, type, verified')
            .eq('id', project.organization_id);
          if (orgList?.[0]) {
            (contentDetails as Record<string, unknown>).organization = orgList[0];
          }
        }
      }
    } else if (report.content_type === 'organization') {
      const { data: orgList } = await supabase
        .from('organizations')
        .select('id, name, username, description, type, verified, created_by')
        .eq('id', report.content_id);

      const org = orgList?.[0];
      if (org) {
        contentDetails = org;
        const { data: creatorList } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .eq('id', org.created_by);
        creatorProfile = creatorList?.[0] || null;
      }
    }

    return {
      success: true,
      data: {
        report,
        reporter: reporterProfile,
        reviewer: reviewerProfile,
        content: contentDetails,
        creator: creatorProfile,
      },
    };
  } catch (e) {
    console.error('Error fetching detailed report:', e);
    return {
      error: `Failed to fetch report: ${e instanceof Error ? e.message : 'Unknown error'}`,
      data: undefined,
    };
  }
}

/**
 * Take a moderator action on a content report
 */
export async function takeModeratorAction(
  reportId: string,
  action: 'warn_user' | 'remove_content' | 'block_content' | 'dismiss' | 'escalate_to_legal',
  reason?: string
) {
  const viewerSupabase = await createClient();
  const supabase = getAdminClient(); // Use service role to bypass RLS
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const { data: { user } } = await viewerSupabase.auth.getUser();
  if (!user) {
    return { error: "No authenticated user" };
  }

  try {
    // Get the report
    const { data: report, error: reportError } = await supabase
      .from('content_reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return { error: `Report not found: ${reportError?.message}` };
    }

    // Map actions to corresponding status
    let newStatus = report.status;
    let actionNotes = '';

    switch (action) {
      case 'dismiss':
        newStatus = 'dismissed';
        actionNotes = 'Content dismissed by moderator';
        break;
      case 'remove_content':
        newStatus = 'resolved';
        actionNotes = 'Content removed by moderator';
        break;
      case 'block_content':
        newStatus = 'resolved';
        actionNotes = 'Content blocked by moderator';
        break;
      case 'warn_user':
        newStatus = 'under_review';
        actionNotes = 'User warned by moderator - awaiting compliance';
        break;
      case 'escalate_to_legal':
        newStatus = 'under_review';
        actionNotes = 'Escalated to legal team for review';
        break;
    }

    // Update the report with action taken
    const resolutionNotes = [
      report.resolution_notes || '',
      `\n[Action taken] ${new Date().toISOString()}: ${actionNotes}${reason ? ` - ${reason}` : ''}`,
    ].filter(Boolean).join('');

    const { data, error } = await supabase
      .from('content_reports')
      .update({
        status: newStatus,
        resolution_notes: resolutionNotes,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      console.error('Error taking moderator action on report %s:', reportId, error);
      return { error: error.message };
    }

    // If removing/blocking content, also flag it in content_flags
    if (action === 'remove_content' || action === 'block_content') {
      const flagType = action === 'remove_content' ? 'removal' : 'suspension';
      await supabase
        .from('content_flags')
        .insert({
          content_type: report.content_type,
          content_id: report.content_id,
          flag_type: flagType,
          confidence_score: 1.0,
          flag_source: 'moderator',
          status: 'confirmed',
          flag_details: {
            action,
            reason,
            takenBy: user.id,
          },
        });
    }

    if (action === 'remove_content' || action === 'block_content') {
      await softRemoveContent(supabase, report.content_type, report.content_id, action, user.id, reason);
    }

    if (action === 'remove_content' || action === 'block_content' || action === 'warn_user') {
      await notifyContentOwnerOfModeration({
        supabase,
        contentType: report.content_type,
        contentId: report.content_id,
        action,
        reason: reason || actionNotes,
      });
    }

    return {
      success: true,
      data,
      message: `Action '${action}' taken on report ${reportId}`,
    };
  } catch (e) {
    console.error('Error taking moderator action:', e);
    return { error: `Failed to take action: ${e instanceof Error ? e.message : 'Unknown error'}` };
  }
}

async function softRemoveContent(
  supabase: ReturnType<typeof getAdminClient>,
  contentType: string,
  contentId: string,
  action: 'remove_content' | 'block_content',
  adminUserId: string,
  reason?: string
) {
  const now = new Date().toISOString();

  if (contentType === 'project') {
    await supabase
      .from('projects')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancellation_reason: `Moderation ${action.replace('_', ' ')}${reason ? `: ${reason}` : ''}`,
      })
      .eq('id', contentId);
    return;
  }

  if (contentType === 'profile') {
    await supabase
      .from('profiles')
      .update({
        profile_visibility: 'private',
        updated_at: now,
      })
      .eq('id', contentId);
    return;
  }

  if (contentType === 'organization') {
    await supabase
      .from('organizations')
      .update({
        verified: false,
        updated_at: now,
      })
      .eq('id', contentId);
    return;
  }

  await notifyAdminsBatched({
    type: 'content_report',
    reportId: contentId,
    reason: `Unsupported moderation removal for ${contentType}`,
    contentType,
    priority: 'normal',
  });
}

type ModerationAction = 'warn_user' | 'remove_content' | 'block_content' | 'dismiss' | 'escalate_to_legal';

type ContentOwnerInfo = {
  userId: string;
  userName: string;
  userEmail?: string | null;
  contentTitle: string;
  contentTypeLabel: string;
  contentUrl?: string;
};

function deriveSeverity(confidence: number | string | null | undefined) {
  const value = typeof confidence === 'string' ? Number(confidence) : confidence ?? 0;
  if (value >= 0.85) return 'critical';
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'medium';
  return 'low';
}

function formatContentTypeLabel(contentType: string) {
  switch (contentType) {
    case 'project':
      return 'project';
    case 'profile':
      return 'profile';
    case 'organization':
      return 'organization';
    default:
      return 'content';
  }
}

async function fetchAuthUserEmail(supabase: ReturnType<typeof getAdminClient>, userId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    console.error('Error fetching auth user email:', error);
    return null;
  }
  return data?.user?.email ?? null;
}

async function resolveContentOwnerInfo(
  supabase: ReturnType<typeof getAdminClient>,
  contentType: string,
  contentId: string
): Promise<ContentOwnerInfo | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lets-assist.com';

  if (contentType === 'project') {
    const { data: project } = await supabase
      .from('projects')
      .select('id, title, creator_id')
      .eq('id', contentId)
      .maybeSingle();

    if (!project?.creator_id) return null;

    const { data: creator } = await supabase
      .from('profiles')
      .select('id, full_name, username, email')
      .eq('id', project.creator_id)
      .maybeSingle();

    const userEmail = creator?.email || (await fetchAuthUserEmail(supabase, project.creator_id));
    const userName = creator?.full_name || creator?.username || 'there';

    return {
      userId: project.creator_id,
      userName,
      userEmail,
      contentTitle: project.title || 'Untitled project',
      contentTypeLabel: 'project',
      contentUrl: `${baseUrl}/projects/${contentId}`,
    };
  }

  if (contentType === 'profile') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, username, email')
      .eq('id', contentId)
      .maybeSingle();

    if (!profile) return null;
    const userEmail = profile.email || (await fetchAuthUserEmail(supabase, contentId));
    const userName = profile.full_name || profile.username || 'there';
    const profileSlug = profile.username || contentId;

    return {
      userId: contentId,
      userName,
      userEmail,
      contentTitle: profile.full_name || profile.username || 'Your profile',
      contentTypeLabel: 'profile',
      contentUrl: `${baseUrl}/profile/${profileSlug}`,
    };
  }

  if (contentType === 'organization') {
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, username, created_by')
      .eq('id', contentId)
      .maybeSingle();

    if (!org?.created_by) return null;

    const { data: creator } = await supabase
      .from('profiles')
      .select('id, full_name, username, email')
      .eq('id', org.created_by)
      .maybeSingle();

    const userEmail = creator?.email || (await fetchAuthUserEmail(supabase, org.created_by));
    const userName = creator?.full_name || creator?.username || 'there';
    const orgSlug = org.username || contentId;

    return {
      userId: org.created_by,
      userName,
      userEmail,
      contentTitle: org.name || 'Organization',
      contentTypeLabel: 'organization',
      contentUrl: `${baseUrl}/organization/${orgSlug}`,
    };
  }

  return null;
}

function buildModerationCopy(
  action: ModerationAction,
  contentTypeLabel: string,
  contentTitle: string,
  reason?: string
) {
  const safeReason = reason ? `Reason: ${reason}` : 'Reason: Policy violation.';
  const baseTitle = `Update on your ${contentTypeLabel}`;

  switch (action) {
    case 'remove_content':
      return {
        title: baseTitle,
        body: `We removed your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Your ${contentTypeLabel} was removed`,
        actionLabel: 'removed',
      };
    case 'block_content':
      return {
        title: baseTitle,
        body: `We blocked your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Your ${contentTypeLabel} was blocked`,
        actionLabel: 'blocked',
      };
    case 'warn_user':
      return {
        title: baseTitle,
        body: `We issued a warning about your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Warning about your ${contentTypeLabel}`,
        actionLabel: 'issued a warning about',
      };
    default:
      return {
        title: baseTitle,
        body: `We reviewed your ${contentTypeLabel} “${contentTitle}”. ${safeReason}`,
        emailSubject: `Update on your ${contentTypeLabel}`,
        actionLabel: 'updated',
      };
  }
}

async function shouldSendGeneralNotification(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string
) {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('general')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking notification settings:', error);
    return true;
  }

  return data?.general !== false;
}

async function notifyContentOwnerOfModeration({
  supabase,
  contentType,
  contentId,
  action,
  reason,
}: {
  supabase: ReturnType<typeof getAdminClient>;
  contentType: string;
  contentId: string;
  action: ModerationAction;
  reason?: string;
}) {
  const owner = await resolveContentOwnerInfo(supabase, contentType, contentId);
  if (!owner) {
    return;
  }

  const { title, body, emailSubject, actionLabel } = buildModerationCopy(
    action,
    formatContentTypeLabel(owner.contentTypeLabel),
    owner.contentTitle,
    reason
  );

  const shouldNotify = await shouldSendGeneralNotification(supabase, owner.userId);

  if (shouldNotify) {
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: owner.userId,
        title,
        body,
        type: 'general',
        severity: 'warning',
        action_url: owner.contentUrl,
        displayed: false,
        read: false,
        data: {
          kind: 'moderation_action',
          action,
          contentType,
          contentId,
        },
      });

    if (notificationError) {
      console.error('Error creating moderation notification:', notificationError);
    }
  }

  if (owner.userEmail) {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lets-assist.com';
    await sendEmail({
      to: owner.userEmail,
      subject: emailSubject,
      react: ContentModerationActionEmail({
        userName: owner.userName,
        contentTitle: owner.contentTitle,
        contentTypeLabel: owner.contentTypeLabel,
        actionLabel,
        reason,
        contentUrl: owner.contentUrl,
        supportUrl: `${baseUrl}/help`,
      }),
      userId: owner.userId,
      type: 'transactional',
    });
  }
}
