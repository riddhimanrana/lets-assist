import { Profile, ProfileVisibility } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Determine if a user can view a profile based on visibility settings
 */
export async function canViewProfile(
  targetProfile: Profile,
  viewerUserId?: string | null
): Promise<boolean> {
  // If no visibility setting, default to public
  const visibility: ProfileVisibility = targetProfile.profile_visibility || 'public';
  
  // Public profiles: everyone can view
  if (visibility === 'public') return true;
  
  // User viewing their own profile: always allowed
  if (viewerUserId && targetProfile.email === viewerUserId) return true;
  
  // Private profiles: only owner can view
  if (visibility === 'private') return false;
  
  // Organization-only: check if viewer is in same organization
  if (visibility === 'organization_only') {
    if (!viewerUserId || !targetProfile.organization_id) return false;
    
    // This would need to query the database to check if viewer is in same org
    // For now, return false - implement in actual usage with proper DB query
    return false;
  }
  
  return false;
}

/**
 * Check if two users are in the same organization
 */
export async function isInSameOrganization(
  userId1: string,
  userId2: string,
  supabaseClient: SupabaseClient
): Promise<boolean> {
  const { data: profile1 } = await supabaseClient
    .from('profiles')
    .select('organization_id')
    .eq('id', userId1)
    .single();
  
  const { data: profile2 } = await supabaseClient
    .from('profiles')
    .select('organization_id')
    .eq('id', userId2)
    .single();
  
  if (!profile1?.organization_id || !profile2?.organization_id) return false;
  
  return profile1.organization_id === profile2.organization_id;
}
