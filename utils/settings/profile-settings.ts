/**
 * Profile visibility settings
 * Simplified version without institution-based restrictions
 */

import { createClient } from '@/utils/supabase/server';
import { ProfileVisibility } from '@/types';

/**
 * Check if email domain is linked to an organization with auto-join
 */
export async function getOrganizationByDomain(domain: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('id, name, username, auto_join_domain')
    .eq('auto_join_domain', domain.toLowerCase())
    .single();

  return data;
}

/**
 * Get default profile visibility
 */
export function getDefaultProfileVisibility(): ProfileVisibility {
  return 'public';
}

/**
 * Can user change their profile visibility?
 * All users can change visibility
 */
export function canChangeProfileVisibility(): boolean {
  return true;
}

/**
 * Apply visibility constraints
 */
export function applyVisibilityConstraints(
  visibility: ProfileVisibility
): ProfileVisibility {
  return visibility;
}
