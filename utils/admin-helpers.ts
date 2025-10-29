/**
 * Admin Helper Functions
 * 
 * Utilities for checking admin permissions and roles
 */

import { createClient } from '@/utils/supabase/server';
import { checkSuperAdmin } from '@/app/admin/actions';

/**
 * Check if current user is a platform admin (super admin)
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const { isAdmin } = await checkSuperAdmin();
  return isAdmin;
}

/**
 * Check if user is an organization admin
 */
export async function isOrganizationAdmin(organizationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return false;
  
  // Check organization_members table
  const { data, error } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();
  
  if (error || !data) return false;
  
  return data.role === 'admin' || data.role === 'trusted';
}

/**
 * Check if user can view moderation logs for an organization
 */
export async function canViewOrgModeration(organizationId: string): Promise<boolean> {
  // Super admins can view everything
  if (await isPlatformAdmin()) return true;
  
  // Org admins can view their org's logs
  return await isOrganizationAdmin(organizationId);
}

/**
 * Get user's admin context
 */
export async function getAdminContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { user: null, isPlatformAdmin: false, organizations: [] };
  }
  
  const isPlatform = await isPlatformAdmin();
  
  // Get organizations where user is admin
  const { data: orgs } = await supabase
    .from('organization_members')
    .select(`
      organization_id,
      role,
      organizations (
        id,
        name,
        image_url
      )
    `)
    .eq('user_id', user.id)
    .in('role', ['admin', 'trusted']);
  
  return {
    user,
    isPlatformAdmin: isPlatform,
    organizations: orgs || [],
  };
}
