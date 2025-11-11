/**
 * Profile visibility settings for CIPA compliance
 * Handles age-based profile visibility rules
 */

import { calculateAge } from '@/utils/age-helpers';
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
 * Get default profile visibility based on age
 * - Under 13: Always private
 * - 13-17: Default private
 * - 18+: Default public
 */
export function getDefaultProfileVisibility(
  dateOfBirth: string | Date | null,
  isInstitutionAccount: boolean
): ProfileVisibility {
  if (!dateOfBirth) return 'public';

  const age = calculateAge(dateOfBirth);

  // Under 13: Always private
  if (age < 13) return 'private';

  // 13-17: Default private
  if (age < 18) return 'private';

  // 18+: Default public
  return 'public';
}

/**
 * Can user change their profile visibility?
 * Only under 13 users are locked to private
 */
export function canChangeProfileVisibility(dateOfBirth: string | Date | null): boolean {
  if (!dateOfBirth) return true;
  const age = calculateAge(dateOfBirth);
  // Only under 13 cannot change (they're locked to private)
  return age >= 13;
}

/**
 * Apply visibility constraints
 * Forces under 13 to private regardless of user preference
 */
export function applyVisibilityConstraints(
  visibility: ProfileVisibility,
  dateOfBirth: string | Date | null
): ProfileVisibility {
  if (!dateOfBirth) return visibility;

  const age = calculateAge(dateOfBirth);

  // Under 13 is always forced private
  if (age < 13) return 'private';

  return visibility;
}
