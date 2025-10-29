"use server";

import { createClient } from "@/utils/supabase/server";
import { checkSuperAdmin } from "../actions";

/**
 * Get all flagged content for admin review
 */
export async function getFlaggedContent(status?: 'pending_review' | 'blocked' | 'confirmed' | 'dismissed') {
  const supabase = await createClient();
  
  // Check if user is super admin
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  let query = supabase
    .from('flagged_content')
    .select(`
      *,
      profiles!user_id (
        full_name,
        email,
        username
      )
    `)
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
  
  const { data, error } = await supabase
    .from('moderation_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) {
    console.error('Error fetching moderation logs:', error);
    return { error: error.message };
  }
  
  return { data };
}

/**
 * Update flagged content status
 */
export async function updateFlaggedContentStatus(
  id: string,
  status: 'pending_review' | 'blocked' | 'confirmed' | 'dismissed',
  reviewNotes?: string
) {
  const supabase = await createClient();
  
  const { isAdmin } = await checkSuperAdmin();
  if (!isAdmin) {
    return { error: "Unauthorized - Admin access required" };
  }
  
  const { data: { user } } = await supabase.auth.getUser();
  
  const { data, error } = await supabase
    .from('flagged_content')
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
    .from('flagged_content')
    .select('*', { count: 'exact', head: true });
  
  const { count: pendingCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  
  const { count: blockedCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'blocked');
  
  const { count: criticalCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .in('severity', ['critical', 'high']);
  
  // Get recent violations (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { count: recentCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo.toISOString());
  
  // Get moderation activity (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const { count: activityCount } = await supabase
    .from('moderation_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', thirtyDaysAgo.toISOString());
  
  return {
    data: {
      total: totalFlagged || 0,
      pending: pendingCount || 0,
      blocked: blockedCount || 0,
      critical: criticalCount || 0,
      recentWeek: recentCount || 0,
      monthlyActivity: activityCount || 0,
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
  
  // This would need a more complex query in production
  // For now, we'll get all flagged content and aggregate by user
  const { data, error } = await supabase
    .from('flagged_content')
    .select(`
      user_id,
      severity,
      profiles!user_id (
        full_name,
        email,
        username
      )
    `);
  
  if (error) {
    console.error('Error fetching repeat offenders:', error);
    return { error: error.message };
  }
  
  // Group by user and count violations
  const userViolations = data.reduce((acc: any, item: any) => {
    if (!acc[item.user_id]) {
      acc[item.user_id] = {
        userId: item.user_id,
        profile: item.profiles,
        violations: 0,
        criticalCount: 0,
      };
    }
    acc[item.user_id].violations++;
    if (item.severity === 'critical' || item.severity === 'high') {
      acc[item.user_id].criticalCount++;
    }
    return acc;
  }, {});
  
  // Convert to array and filter for repeat offenders (3+ violations)
  const offenders = Object.values(userViolations)
    .filter((u: any) => u.violations >= 3)
    .sort((a: any, b: any) => b.violations - a.violations);
  
  return { data: offenders };
}
