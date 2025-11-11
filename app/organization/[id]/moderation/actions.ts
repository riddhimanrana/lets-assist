"use server";

import { createClient } from "@/utils/supabase/server";
import { canViewOrgModeration } from "@/utils/admin-helpers";

/**
 * Get flagged content for a specific organization
 */
export async function getOrgFlaggedContent(
  organizationId: string,
  status?: 'pending_review' | 'blocked' | 'confirmed' | 'dismissed'
) {
  const supabase = await createClient();
  
  // Check permissions
  const canView = await canViewOrgModeration(organizationId);
  if (!canView) {
    return { error: "Unauthorized - Organization admin access required" };
  }
  
  // Get organization projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', organizationId);
  
  if (!projects || projects.length === 0) {
    return { data: [] };
  }
  
  const projectIds = projects.map(p => p.id);
  
  // Get flagged content from organization members and projects
  let query = supabase
    .from('flagged_content')
    .select(`
      *,
      profiles!user_id (
        full_name,
        email,
        username,
        organization_id
      )
    `)
    .or(`content_id.in.(${projectIds.join(',')})`)
    .order('created_at', { ascending: false });
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error} = await query;
  
  if (error) {
    console.error('Error fetching org flagged content:', error);
    return { error: error.message };
  }
  
  return { data };
}

/**
 * Get organization moderation stats
 */
export async function getOrgModerationStats(organizationId: string) {
  const supabase = await createClient();
  
  const canView = await canViewOrgModeration(organizationId);
  if (!canView) {
    return { error: "Unauthorized" };
  }
  
  // Get organization projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('organization_id', organizationId);
  
  if (!projects || projects.length === 0) {
    return { 
      data: {
        total: 0,
        pending: 0,
        blocked: 0,
        critical: 0,
        recentWeek: 0,
      }
    };
  }
  
  const projectIds = projects.map(p => p.id);
  
  // Get total counts for organization
  const { count: totalFlagged } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .or(`content_id.in.(${projectIds.join(',')})`);
  
  const { count: pendingCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .or(`content_id.in.(${projectIds.join(',')})`)
    .eq('status', 'pending_review');
  
  const { count: blockedCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .or(`content_id.in.(${projectIds.join(',')})`)
    .eq('status', 'blocked');
  
  const { count: criticalCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .or(`content_id.in.(${projectIds.join(',')})`)
    .in('severity', ['critical', 'high']);
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const { count: recentCount } = await supabase
    .from('flagged_content')
    .select('*', { count: 'exact', head: true })
    .or(`content_id.in.(${projectIds.join(',')})`)
    .gte('created_at', sevenDaysAgo.toISOString());
  
  return {
    data: {
      total: totalFlagged || 0,
      pending: pendingCount || 0,
      blocked: blockedCount || 0,
      critical: criticalCount || 0,
      recentWeek: recentCount || 0,
    }
  };
}
