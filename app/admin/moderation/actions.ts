"use server";

import { createClient } from "@/utils/supabase/server";
import { checkSuperAdmin } from "../actions";

/**
 * Get all flagged content for admin review
 */
export async function getFlaggedContent(status?: 'pending' | 'blocked' | 'confirmed' | 'dismissed') {
  const supabase = await createClient();
  
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
export async function getUserModerationLogs(userId: string) {
  const supabase = await createClient();
  
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
  const supabase = await createClient();
  
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
  const supabase = await createClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  // content_flags doesn't have user_id, so this function is not applicable yet
  // Return empty array for now
  return { data: [] };
}

/**
 * Get all content reports for admin review
 */
export async function getContentReports(status?: 'pending' | 'under_review' | 'resolved' | 'dismissed' | 'escalated') {
  const supabase = await createClient();
  
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
      
      // Enhance data with profile info
      const enhancedData = data.map(report => ({
        ...report,
        reporter: report.reporter_id ? profileMap.get(report.reporter_id) : null,
        reviewer: report.reviewed_by ? profileMap.get(report.reviewed_by) : null,
      }));
      
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
  const supabase = await createClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await supabase.auth.getUser();
  
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
 * Get content reports statistics
 */
export async function getContentReportsStats() {
  const supabase = await createClient();
  
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
