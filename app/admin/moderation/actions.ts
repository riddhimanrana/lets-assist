"use server";

import { createClient } from "@/utils/supabase/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { checkSuperAdmin } from "../actions";
import { NotificationService } from "@/services/notifications";

/**
 * Get all flagged content for admin review
 */
export async function getFlaggedContent(status?: 'pending' | 'blocked' | 'confirmed' | 'dismissed') {
  const supabase = getServiceRoleClient();
  
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
  
  return { data };
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
  const supabase = await createClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await supabase.auth.getUser();
  
  const { data, error } = await supabase
    .from('content_flags')
    .update({ 
      status,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating flagged content:', error);
    return { error: error.message };
  }
  
  return { data };
}

/**
 * Get moderation statistics
 */
export async function getModerationStats() {
  const supabase = getServiceRoleClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  // Get total counts
  const { count: totalFlagged } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true });
  
  const { count: pendingCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  const { count: blockedCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'blocked');
  
  // Get critical count (using confidence_score as a proxy for severity)
  const { count: criticalCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .gte('confidence_score', 0.8);
  
  // Get recent violations (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { count: recentCount } = await supabase
    .from('content_flags')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString());
  
  return {
    data: {
      total: totalFlagged || 0,
      pending: pendingCount || 0,
      blocked: blockedCount || 0,
      critical: criticalCount || 0,
      recentWeek: recentCount || 0,
      monthlyActivity: 0, // moderation_logs table doesn't exist yet
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
  const supabase = getServiceRoleClient();
  
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
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed' | 'escalated',
  resolutionNotes?: string
) {
  const viewerSupabase = await createClient();
  const supabase = getServiceRoleClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await viewerSupabase.auth.getUser();
  
  const { data, error } = await supabase
    .from('content_reports')
    .update({ 
      status,
      reviewed_by: user?.id,
      reviewed_at: new Date().toISOString(),
      resolution_notes: resolutionNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating content report:', error);
    return { error: error.message };
  }
  
  return { data };
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
  const supabase = getServiceRoleClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }

  const {
    data: { user },
  } = await viewerSupabase.auth.getUser();

  const resolvedAt = new Date().toISOString();
  const normalizedStatus = status === 'investigating' ? 'under_review' : status;

  const { error: updateError } = await supabase
    .from('content_reports')
    .update({
      status: normalizedStatus,
      resolution_notes: message,
      reviewed_by: user?.id ?? null,
      reviewed_at: resolvedAt,
      updated_at: resolvedAt,
    })
    .eq('id', reportId)
    .select('id')
    .single();

  if (updateError) {
    return { error: updateError.message };
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
  const supabase = getServiceRoleClient();
  
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
