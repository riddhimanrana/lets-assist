/**
 * Profile visibility settings
 * Simplified version without age-based restrictions
 */

import { createClient } from '@/utils/supabase/server';
import { ProfileVisibility } from '@/types';

/**
 * Check if email is from an institution domain
 */
export async function isInstitutionEmail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from('educational_institutions')
    .select('id')
    .eq('domain', domain)
    .eq('verified', true)
    .single();

  return !!data;
}

/**
 * Get educational institution info for a domain
 */
export async function getInstitutionByDomain(domain: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('educational_institutions')
    .select('*')
    .eq('domain', domain.toLowerCase())
    .eq('verified', true)
    .single();

  return data;
}

/**
 * Get default profile visibility
 * Institution accounts default to private, others to public
 */
export function getDefaultProfileVisibility(
  isInstitutionAccount: boolean
): ProfileVisibility {
  // Institution accounts (school emails) default to private
  if (isInstitutionAccount) return 'private';
  
  // Regular accounts default to public
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
 * No age-based restrictions anymore
 */
export function applyVisibilityConstraints(
  visibility: ProfileVisibility
): ProfileVisibility {
  return visibility;
}
